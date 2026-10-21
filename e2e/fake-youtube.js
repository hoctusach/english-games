// Stands in for https://www.youtube.com/iframe_api in end-to-end tests: a player
// with its own clock that behaves like YouTube's where it matters — it reports
// its time only every 200 ms, keeps reporting the old time for a moment after a
// seek, and announces state changes asynchronously.
(function () {
  var REPORT_MS = 200;
  var SEEK_LAG_MS = 300;
  var DURATION = 600;
  // a short video for tests that play one through
  var SHORT = { Short000000: 13 };

  function FakePlayer(el, options) {
    var self = this;
    this.options = options;
    this.videoId = options.videoId;
    this.duration = SHORT[options.videoId] || DURATION;
    this.t = 0;
    this.reported = 0;
    this.playing = false;
    this.muted = false;
    this.rate = 1;
    this.state = -1;
    this.lastAt = performance.now();
    this.seekUntil = 0;
    this.calls = [];
    var box = document.createElement('div');
    box.className = 'fake-yt';
    box.dataset.video = options.videoId;
    box.style.cssText = 'position:absolute;inset:0;background:#222;color:#888;display:grid;place-items:center;font:12px monospace';
    box.textContent = 'fake video ' + options.videoId;
    el.replaceWith(box);
    this.box = box;
    window.__yt = this;
    window.__ytPlayers = (window.__ytPlayers || 0) + 1;

    this.timer = setInterval(function () {
      self.advance();
      if (performance.now() >= self.seekUntil) self.reported = self.t;
    }, REPORT_MS);

    setTimeout(function () {
      if (self.videoId === 'NoEmbed0000') {
        self.fire('onError', { data: 150 });
        return;
      }
      if (self.videoId === 'Missing0000') {
        self.fire('onError', { data: 100 });
        return;
      }
      self.fire('onReady', {});
    }, 60);
  }

  FakePlayer.prototype.fire = function (name, event) {
    var handler = this.options.events && this.options.events[name];
    if (handler) handler(Object.assign({ target: this }, event));
  };
  FakePlayer.prototype.setState = function (state) {
    var self = this;
    this.state = state;
    setTimeout(function () {
      self.fire('onStateChange', { data: state });
    }, 20);
  };
  FakePlayer.prototype.advance = function () {
    var now = performance.now();
    if (this.playing) {
      this.t += ((now - this.lastAt) / 1000) * this.rate;
      if (this.t >= this.duration) {
        this.t = this.duration;
        this.playing = false;
        this.setState(0);
      }
    }
    this.lastAt = now;
  };
  FakePlayer.prototype.playVideo = function () {
    this.calls.push('play');
    this.advance();
    if (this.playing) return;
    this.playing = true;
    this.setState(3);
    this.setState(1);
  };
  FakePlayer.prototype.pauseVideo = function () {
    this.calls.push('pause');
    this.advance();
    if (!this.playing) return;
    this.playing = false;
    this.setState(2);
  };
  FakePlayer.prototype.seekTo = function (seconds) {
    this.calls.push('seek:' + seconds.toFixed(2));
    this.advance();
    this.t = Math.max(0, Math.min(this.duration, seconds));
    this.seekUntil = performance.now() + SEEK_LAG_MS;
  };
  FakePlayer.prototype.getCurrentTime = function () {
    return this.reported;
  };
  FakePlayer.prototype.setPlaybackRate = function (rate) {
    this.advance();
    this.rate = rate;
  };
  FakePlayer.prototype.mute = function () {
    this.muted = true;
  };
  FakePlayer.prototype.unMute = function () {
    this.muted = false;
  };
  FakePlayer.prototype.isMuted = function () {
    return this.muted;
  };
  FakePlayer.prototype.getDuration = function () {
    return this.duration;
  };
  FakePlayer.prototype.getVideoData = function () {
    return { title: 'Fake video title' };
  };
  FakePlayer.prototype.destroy = function () {
    clearInterval(this.timer);
    this.destroyed = true;
    this.box.remove();
  };
  // test helper: what the user would see/hear right now
  FakePlayer.prototype.now = function () {
    this.advance();
    return this.t;
  };

  window.YT = { Player: FakePlayer, PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } };
  setTimeout(function () {
    if (window.onYouTubeIframeAPIReady) window.onYouTubeIframeAPIReady();
  }, 30);
})();
