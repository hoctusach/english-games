import { describe, expect, it } from 'vitest';
import { cleanCaption, parseTimestamp, parseTranscript } from '@/shadowing/transcriptParse';

describe('parseTimestamp', () => {
  it('reads m:ss, h:mm:ss and fractions', () => {
    expect(parseTimestamp('0:05')).toBe(5);
    expect(parseTimestamp('12:34')).toBe(754);
    expect(parseTimestamp('1:02:03')).toBe(3723);
    expect(parseTimestamp('00:00:01,500')).toBe(1.5);
    expect(parseTimestamp('00:01.250')).toBe(1.25);
    expect(parseTimestamp('abc')).toBeNull();
    expect(parseTimestamp('5')).toBeNull();
  });
});

describe('YouTube "Show transcript" copy', () => {
  it('reads times on their own lines', () => {
    const parsed = parseTranscript('0:00\nhello everyone\n0:03\nwelcome to the show\n0:07\ntoday we talk');
    expect(parsed?.format).toBe('youtube');
    expect(parsed?.captions).toEqual([
      { start: 0, end: 3, text: 'hello everyone' },
      { start: 3, end: 7, text: 'welcome to the show' },
      { start: 7, end: expect.any(Number), text: 'today we talk' },
    ]);
    expect(parsed!.captions[2].end!).toBeGreaterThan(7.5);
  });

  it('skips the header, the spoken-duration labels and blank lines (Windows newlines too)', () => {
    const text = [
      'Transcript',
      'Search in video',
      '0:01',
      '1 second',
      'Hi there.',
      '',
      '1:05',
      '1 minute, 5 seconds',
      'How are you?',
      '1:02:03',
      '1 giờ, 2 phút, 3 giây',
      'Fine thanks.',
    ].join('\r\n');
    const parsed = parseTranscript(text)!;
    expect(parsed.captions.map((c) => [c.start, c.text])).toEqual([
      [1, 'Hi there.'],
      [65, 'How are you?'],
      [3723, 'Fine thanks.'],
    ]);
  });

  it('leaves out chapter headings', () => {
    const parsed = parseTranscript('Chapter 1: The idea\n0:16\na few years ago\n0:39\nthe right amount\nChapter 2: Benefits of new habits\n0:48\n30-day challenges')!;
    expect(parsed.captions.map((c) => c.text)).toEqual(['a few years ago', 'the right amount', '30-day challenges']);
  });

  it('reads a time and the words on one line', () => {
    const parsed = parseTranscript('0:00 hello there\n[0:04] how are you\n0:09 - fine thanks')!;
    expect(parsed.captions.map((c) => [c.start, c.text])).toEqual([
      [0, 'hello there'],
      [4, 'how are you'],
      [9, 'fine thanks'],
    ]);
  });

  it('keeps a spoken time inside the text when times have their own lines', () => {
    const parsed = parseTranscript('0:00\nwe meet at\n10:30 in the morning\n0:05\nsee you')!;
    expect(parsed.captions[0].text).toBe('we meet at 10:30 in the morning');
    expect(parsed.captions[1].start).toBe(5);
  });

  it('joins lines that wrap under one time', () => {
    const parsed = parseTranscript('0:00\nfirst part\nsecond part\n0:04\nnext')!;
    expect(parsed.captions[0].text).toBe('first part second part');
  });

  it('drops sound labels but keeps the line before them from running into the music', () => {
    const parsed = parseTranscript('0:00\nhello\n0:02\n[Music]\n0:30\nwelcome back')!;
    expect(parsed.captions).toEqual([
      { start: 0, end: 2, text: 'hello' },
      { start: 30, end: expect.any(Number), text: 'welcome back' },
    ]);
  });

  it('returns null with no times', () => {
    expect(parseTranscript('just some text\nwithout any times')).toBeNull();
    expect(parseTranscript('   ')).toBeNull();
  });
});

describe('.srt', () => {
  it('reads cues with tags and multiple lines', () => {
    const srt = `1
00:00:01,000 --> 00:00:03,500
<i>Hello</i> there,
my friend.

2
00:00:04,000 --> 00:00:06,000
{\\an8}How &amp; why?

`;
    const parsed = parseTranscript(srt)!;
    expect(parsed.format).toBe('srt');
    expect(parsed.captions).toEqual([
      { start: 1, end: 3.5, text: 'Hello there, my friend.' },
      { start: 4, end: 6, text: 'How & why?' },
    ]);
  });
});

describe('.vtt', () => {
  it('reads cues and skips the header and notes', () => {
    const vtt = `WEBVTT
Kind: captions
Language: en

NOTE this is a comment

00:01.000 --> 00:03.000 align:start position:0%
Hello world.

00:03.000 --> 00:05.000
Second line.
`;
    const parsed = parseTranscript(vtt)!;
    expect(parsed.format).toBe('vtt');
    expect(parsed.captions).toEqual([
      { start: 1, end: 3, text: 'Hello world.' },
      { start: 3, end: 5, text: 'Second line.' },
    ]);
  });

  it('removes the repeats of YouTube rolling auto-captions', () => {
    const vtt = `WEBVTT
Kind: captions
Language: en

00:00:00.320 --> 00:00:02.990 align:start position:0%
 
so<00:00:00.640><c> today</c><00:00:00.960><c> we're</c><00:00:01.280><c> going</c>

00:00:02.990 --> 00:00:03.000 align:start position:0%
so today we're going
 

00:00:03.000 --> 00:00:05.430 align:start position:0%
so today we're going
to<00:00:03.360><c> talk</c><00:00:03.600><c> about</c><00:00:03.920><c> food</c>

00:00:05.430 --> 00:00:05.440 align:start position:0%
to talk about food
 

00:00:05.440 --> 00:00:07.000 align:start position:0%
to talk about food
and<c> drinks</c>
`;
    const parsed = parseTranscript(vtt)!;
    expect(parsed.captions.map((c) => [c.start, c.text])).toEqual([
      [0.32, "so today we're going"],
      [3, 'to talk about food'],
      [5.44, 'and drinks'],
    ]);
  });
});

describe('cleanCaption', () => {
  it('removes non-speech', () => {
    expect(cleanCaption('[Music] ♪ la la ♪')).toBe('la la');
    expect(cleanCaption('>> SPEAKER: Hello (laughs) there')).toBe('Hello there');
    expect(cleanCaption('- Who is it?')).toBe('Who is it?');
    expect(cleanCaption('it&#39;s &quot;fine&quot;&nbsp;now')).toBe('it\'s "fine" now');
    expect(cleanCaption('(Applause)')).toBe('');
    expect(cleanCaption('I (really) mean it')).toBe('I (really) mean it');
  });
});

describe('.srt without blank lines between cues', () => {
  it('does not take the next cue number for words', () => {
    const parsed = parseTranscript('1\n00:00:01,000 --> 00:00:02,000\nHello.\n2\n00:00:02,000 --> 00:00:03,000\nBye.')!;
    expect(parsed.captions.map((c) => c.text)).toEqual(['Hello.', 'Bye.']);
  });

  it('keeps a number that is part of the words', () => {
    const parsed = parseTranscript('00:00:01,000 --> 00:00:02,000\nI counted to\n10\n\n00:00:02,000 --> 00:00:03,000\nThen stopped.')!;
    expect(parsed.captions[0].text).toBe('I counted to 10');
  });
});
