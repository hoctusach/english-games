# Shadowing — research & plan

Trạng thái: **Phase 1 (MVP) đã code xong và có test** — xem mục 7–9 ở cuối. Phase 2–3 chưa làm. Mục tiêu: thêm game thứ hai "Shadowing (Nói đuổi)" vào
Word Shooter: người dùng dán 1 link YouTube, app cắt video thành từng câu, phát từng câu,
dừng cho người dùng nhại lại (hoặc nói đuổi cùng lúc), có thể thu âm để so sánh và chấm điểm.

---

## 1. Market research — các tool hiện có

| Tool | Nền tảng | Lấy phụ đề thế nào | Điểm hay | Hạn chế |
|---|---|---|---|---|
| **Language Reactor** | Extension Chrome (YouTube, Netflix) | Đọc phụ đề ngay trong trang YouTube (extension chạy trong tab nên không bị chặn) | Auto-pause sau mỗi câu, lặp câu, tua câu trước/sau, đổi tốc độ, dịch song ngữ | Chỉ Chrome desktop; không có thu âm/chấm điểm; bản free không lưu được từ |
| **RecEcho** | Extension Chrome | Phụ đề YouTube trong trang | Tự gộp caption thành câu, dừng sau mỗi câu, **thu âm và nghe lại cạnh bản gốc** | Chỉ desktop |
| **AI Shadowing** | Web + Android | Dán URL YouTube → server lấy transcript, AI làm sạch | Transcript từng câu, bấm câu để lặp, chỉnh khoảng nghỉ giữa câu, bấm từ để AI giải thích | Cần backend + AI (có chi phí); không dành cho người mới bắt đầu |
| **FluentDictation** | Web | Server lấy phụ đề YouTube | Kết hợp **chép chính tả + shadowing**, nhận dạng giọng nói để chấm | Cần backend |
| **ShadowingEnglish.com** | Web | Server | Tự chia video thành câu ngắn | Cần backend |
| **Dollim, Mimi, SpeakFox** | App iOS/Android | Server | Lặp đoạn, chậm 0.5x giữ cao độ, thu âm so sánh, chép chính tả (Mimi), vòng "Nghe → Nhắc lại → Chấm điểm" (SpeakFox) | App native, thường trả phí |
| **ELSA Speak** | App | Câu có sẵn, không dùng YouTube | Chấm phát âm đến từng âm vị | Không luyện nhịp/ngữ điệu tự nhiên kiểu shadowing |

**Kết luận từ thị trường** — các tính năng "phải có" lặp đi lặp lại ở mọi tool:
1. Chia video thành **từng câu** (không phải từng dòng caption vụn).
2. **Auto-pause** sau mỗi câu, có khoảng nghỉ để nói lại; nút lặp câu / câu trước / câu sau.
3. **Đổi tốc độ** (0.5x – 1x).
4. **Thu âm và nghe lại** cạnh bản gốc.
5. (Nâng cao) **Chấm điểm** bằng nhận dạng giọng nói, **chép chính tả**.

Điểm khác biệt mà app mình có thể có: miễn phí, không tài khoản, chạy trên điện thoại
(extension Chrome thì không), có chế độ **chép chính tả bằng bàn phím của game** (tận dụng
`OnScreenKeyboard`, `typing.ts`), và **đẩy từ/câu khó sang một word set** để chơi tiếp ở game
bắn từ.

---

## 2. Câu hỏi kỹ thuật chính: lấy CC / subtitle từ YouTube như thế nào?

App hiện tại là **web tĩnh trên GitHub Pages, không có backend**. Điều này quyết định gần như
toàn bộ thiết kế.

### 2.1 Phát video: YouTube IFrame Player API — OK

- Nhúng video bằng IFrame API (`youtube-nocookie.com`), không cần API key.
- Có đủ thứ cần cho shadowing: `seekTo`, `playVideo`, `pauseVideo`, `getCurrentTime`
  (poll ~50 ms để dừng đúng cuối câu), `setPlaybackRate` (0.25 → 2, YouTube tự giữ cao độ).
- Hạn chế: video tắt nhúng (lỗi 101/150) không phát được → báo lỗi rõ ràng; có thể có quảng cáo;
  iOS cần một lần chạm của người dùng trước khi phát; không chạy offline.
- **Không được** tải/trích audio từ YouTube (vi phạm điều khoản) → mọi thứ phải đi qua player.

### 2.2 Lấy phụ đề tự động từ trình duyệt — KHÔNG khả thi

- Endpoint phụ đề `timedtext` không cho phép CORS → trang web của mình không gọi trực tiếp được.
- Từ 2025–2026 YouTube còn yêu cầu **PO token** (do BotGuard trong player JS sinh ra): request
  thiếu token nhận về **HTTP 200 nhưng body rỗng**. Thư viện phổ biến `youtube-transcript-api`
  cũng đang gặp lỗi này.
- YouTube **chặn hầu hết IP cloud**, nên kể cả dựng proxy (Cloudflare Worker…) cũng hay bị chặn
  → phải dùng proxy residential hoặc dịch vụ trả phí (Apify, Supadata…). Mong manh, tốn tiền,
  phải bảo trì liên tục.
- Extension Chrome (Language Reactor, RecEcho) làm được vì chạy **bên trong** trang YouTube —
  web app của mình không có quyền đó.

### 2.3 Các phương án cung cấp transcript

| Phương án | Cách làm | Ưu | Nhược | Đề xuất |
|---|---|---|---|---|
| **A. Dán transcript** | Trên YouTube: "…" → *Show transcript* → bôi đen copy, dán vào app. App parse dạng `0:05\ntext` (hoặc `0:05 text`) | Miễn phí, không backend, ổn định, dùng được CC tự động của mọi video | Thêm 1 bước thủ công; trên điện thoại hơi khó copy | **MVP** |
| **B. Tải file `.srt` / `.vtt`** | Người dùng tải phụ đề bằng tool ngoài (downsub…) hoặc tự có | Timing chính xác nhất | Thêm bước | **MVP** (parser đơn giản) |
| **C. Bài học có sẵn** | Mình chuẩn bị sẵn vài video + transcript JSON, ship cùng app giống `seedSets` | Trải nghiệm tốt nhất cho học sinh/giáo viên, 1 chạm là học | Tốn công soạn; nên chọn video cho phép nhúng, nội dung phù hợp | **MVP** (2–3 bài) |
| **D. Proxy lấy phụ đề** | Cloudflare Worker / dịch vụ transcript trả phí | Chỉ cần dán URL | PO token + chặn IP → hay hỏng; có chi phí; phải giữ API key | Để sau, chỉ làm nếu A/B bị phàn nàn nhiều |
| **E. Tự nhận dạng (Whisper)** | Cần file audio | Không phụ thuộc CC | Không lấy được audio từ YouTube hợp lệ; model nặng | Không làm |

> Gợi ý UX cho A: khi dán URL, app mở sẵn hướng dẫn 3 bước có hình (Show transcript → copy →
> dán). Nếu người dùng chỉ có text **không có thời gian**, app vẫn cho dùng ở chế độ "đọc theo"
> (không tự cắt video) — tính năng phụ, không bắt buộc.

### 2.4 Từ caption vụn → câu hoàn chỉnh

CC tự động của YouTube thường là từng mẩu 2–5 giây, không dấu câu. Cần bước **segment**:
1. Parse thành `{start, text}`; `end` = `start` của dòng kế tiếp (transcript dán vào không có end).
2. Gộp các dòng thành câu: cắt tại `. ? !`; nếu không có dấu câu thì cắt khi có khoảng lặng
   > ~0.8 s hoặc câu dài > ~12 giây / ~20 từ.
3. Người dùng có thể **gộp / tách câu** và kéo mốc ±0.25 s nếu bị lệch (MVP: chỉ gộp/tách).
4. Bỏ dòng kiểu `[Music]`, `[Applause]`.

### 2.5 Thu âm & chấm điểm

- **Thu âm**: `getUserMedia` + `MediaRecorder` (Chrome, Android, iOS Safari 14.3+). Giữ trong
  bộ nhớ, không upload. Nghe lại: bản gốc (seek + play) rồi tới giọng mình.
  Chế độ nói đuổi cùng lúc cần **tai nghe**, không thì mic thu luôn tiếng video.
- **Chấm điểm**: Web Speech API `SpeechRecognition` (Chrome/Edge desktop & Android, Safari iOS
  14.5+; Firefox không có). Lưu ý: Chrome gửi âm thanh lên server Google, không chạy offline;
  in-app browser (Zalo, Messenger) thường không có. → So khớp chữ nhận dạng với câu gốc (diff
  theo từ, tô xanh/đỏ từng từ), ra % từ khớp. **Không chấm âm vị kiểu ELSA** — ngoài phạm vi.
- Khi không có nhận dạng: chấm tự đánh giá 3 mức (😀 / 🙂 / 😕), giống cơ chế adaptive hiện có.

---

## 3. Thiết kế sản phẩm

### 3.1 Luồng chính

```
Home ─┬─ Word Shooter (hiện tại)
      └─ Shadowing
           ├─ Bài học có sẵn (seed)
           ├─ Bài của tôi (localStorage)
           └─ + Bài mới: dán URL YouTube → dán transcript / tải .srt/.vtt
                        → xem trước danh sách câu (gộp/tách) → Lưu & học
```

### 3.2 Màn học (Shadowing screen)

- Trên: video (16:9, thu nhỏ được). Dưới: câu hiện tại to, câu trước/sau mờ.
- Thanh điều khiển: ⏮ câu trước · 🔁 nghe lại · ⏭ câu sau · tốc độ 0.5/0.75/1 · 🎙 thu âm.
- Che/hiện chữ: **Hiện** → **Che bớt** (chỉ chữ cái đầu) → **Ẩn** (nghe thuần).

### 3.3 Các chế độ

| Chế độ | Cách chơi | Ghi chú |
|---|---|---|
| **Nghe & nhắc lại** (mặc định) | Phát 1 câu → tự dừng → chờ khoảng nghỉ = thời lượng câu × 1.2 (chỉnh được) → câu tiếp | Hoặc bấm/nói xong mới đi tiếp |
| **Nói đuổi** (shadowing thật) | Video chạy liên tục (thường 0.75x), người dùng nói cùng lúc, chữ highlight theo câu | Cần tai nghe nếu thu âm |
| **Thu âm & so sánh** | Phát câu → thu giọng → nghe gốc rồi nghe mình → (chấm điểm nếu có) | |
| **Chép chính tả** | Nghe câu, gõ lại bằng bàn phím của game; chữ đúng hiện dần | Tận dụng `typing.ts` + `OnScreenKeyboard`, hợp chất "game gõ chữ" của app |

### 3.4 Liên kết với game bắn từ

- Bấm vào 1 từ trong câu → "Thêm vào word set" (nghĩa nhập tay hoặc để trống), câu chứa từ
  làm **example** (cột 3 sẵn có) → highlight bằng `utils/highlight.ts`.
- Kết thúc bài: tạo word set "Từ khó – <tên video>" để chơi bắn từ.

### 3.5 Dữ liệu (localStorage, giữ phong cách hiện tại)

```ts
// shootwords.shadowLessons.v1
interface ShadowLesson {
  id: string;
  videoId: string;           // 11 ký tự YouTube
  title: string;
  segments: { start: number; end: number; text: string }[];
  source: 'paste' | 'srt' | 'vtt' | 'seed';
  createdAt: number;
}
// shootwords.shadowProgress.v1.<lessonId>
interface ShadowProgress {
  lastSegment: number;
  perSegment: Record<number, { reps: number; bestScore?: number; selfRating?: 1 | 2 | 3 }>;
}
```

Transcript 10 phút ≈ 10–15 KB → vừa localStorage. Nhớ thêm 2 key mới vào `data/backup.ts`.
Không lưu file thu âm (chỉ giữ trong phiên).

---

## 4. Kiến trúc code dự kiến

```
src/shadowing/
  youtube.ts           // parse URL → videoId; load IFrame API; wrapper Player (seek/play/pause/rate/poll)
  transcriptParse.ts   // YouTube "Show transcript" paste, .srt, .vtt → {start,text}[]
  segment.ts           // gộp caption thành câu, tính end, bỏ [Music]
  segmentPlayer.ts     // state machine: playing → gap → next; loop; mode
  recorder.ts          // MediaRecorder wrapper
  recognizer.ts        // SpeechRecognition wrapper + diff theo từ (feature-detect)
  lessonStore.ts       // CRUD bài học + progress
  seedLessons.ts       // bài có sẵn
src/ui/screens/
  ShadowHomeScreen.ts  // danh sách bài + tạo bài mới
  ShadowNewScreen.ts   // dán URL + transcript, xem trước câu
  ShadowScreen.ts      // màn học
```

- Thêm `showShadowHome / showShadowNew / showShadow` vào `App.ts` (cùng `ScreenManager`).
- Thêm chuỗi vi/en vào `i18n.ts`; nút "Shadowing" ở `MenuScreen`.
- Không thêm thư viện mới (IFrame API load bằng thẻ script; parser tự viết, ~100 dòng).
- `public/sw.js`: **không** cache domain YouTube; offline thì màn Shadowing báo "cần mạng".
- Analytics (Umami): `shadow_lesson_created` (nguồn, số câu), `shadow_session` (phút, số câu).

---

## 5. Lộ trình

| Phase | Nội dung | Ước lượng |
|---|---|---|
| **0. Spike** (½ ngày) | Thử IFrame API trên iPhone + Android thật: độ chính xác dừng cuối câu, `setPlaybackRate`, autoplay sau chạm; thử copy transcript YouTube trên mobile | Quyết định go/no-go |
| **1. MVP** | Parser (paste + srt/vtt) + segment · màn tạo bài · màn học chế độ *Nghe & nhắc lại* + *Nói đuổi* · tốc độ · che chữ · lưu bài/tiến độ · backup · 2–3 bài seed | 3–4 ngày |
| **2. Thu âm + chấm** | `recorder.ts`, so sánh gốc/mình, `SpeechRecognition` + diff từ, tự đánh giá khi không hỗ trợ | 2–3 ngày |
| **3. Chép chính tả + nối game bắn từ** | Chế độ dictation dùng bàn phím game · thêm từ vào word set · tạo set "Từ khó" | 2 ngày |
| **4. (Tuỳ chọn) Tự lấy phụ đề** | Proxy/dịch vụ trả phí nếu người dùng thật sự cần; có fallback A/B | Chỉ làm khi có nhu cầu |

### Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Người dùng ngại bước copy transcript | Hướng dẫn có hình; bài seed sẵn; phase 4 nếu cần |
| Dừng cuối câu lệch do poll / buffering | Poll 50 ms, dừng sớm 0.1 s, cho chỉnh mốc thủ công |
| Video bị tắt nhúng / có quảng cáo | Bắt lỗi 101/150, gợi ý chọn video khác |
| SpeechRecognition không có / sai với giọng trẻ em | Feature-detect, chấm điểm chỉ là phụ, luôn có tự đánh giá |
| Bản quyền nội dung bài seed | Chọn video cho phép nhúng; chỉ lưu videoId + transcript, không lưu media |

---

## 6. Cần anh/chị quyết định trước khi code

1. **Đối tượng chính**: trẻ em (như bộ Movers A1, giáo viên cho chơi lần lượt) hay người lớn
   tự học? → ảnh hưởng chọn bài seed, tốc độ mặc định, có cần leaderboard không.
2. **MVP có cần chấm điểm giọng nói không**, hay để phase 2?
3. **Chấp nhận bước dán transcript thủ công** cho MVP (khuyến nghị), hay muốn đầu tư proxy/dịch
   vụ trả phí để chỉ cần dán URL?
4. Có muốn mình chọn sẵn 2–3 video cho bài seed không (gợi ý chủ đề)?

---

## 7. Quyết định (đã chốt)

| Câu hỏi | Trả lời |
|---|---|
| Đối tượng | Cả trẻ em và người lớn, nhiều trình độ → bài chia 3 mức: Trẻ em · Flyers / Trung cấp / Nâng cao |
| Chấm điểm giọng nói | Để Phase 2 |
| Dán transcript thủ công | Chấp nhận cho MVP |
| Video gợi ý | Có: Flyers cho bé, Advanced cho bố/mẹ (+ vài video trung cấp) |

Video gợi ý được lưu dưới dạng **tên video + kênh + từ khoá tìm trên YouTube**, không lưu
ID: lúc làm, sandbox không vào được YouTube để kiểm tra ID/phụ đề, và ID có thể đổi khi kênh
đăng lại video. Người dùng bấm "Tìm trên YouTube" → copy link + transcript → "Tạo bài".
Khi đã có link + transcript chuẩn, có thể đưa thẳng vào app thành bài dựng sẵn.

## 8. Thiết kế đã làm (Phase 1)

**Điều hướng**: Home có 2 ô game (🎯 Bắn từ / 🎧 Shadowing). Ai dùng Shadowing gần nhất thì
mở app sẽ vào thẳng danh sách bài. Code Shadowing là một chunk riêng (~22 KB gzip), tải lúc
rảnh nên mở tức thì và không làm chậm game bắn từ.

**Danh sách bài**: "Học tiếp" (bài gần nhất, n/N câu) · Bài của tôi (thumbnail, thời lượng,
nhãn trình độ, thanh tiến độ, đổi tên/xoá) · Tạo bài mới · Video gợi ý theo tab trình độ.

**Tạo bài**: 3 bước trên một trang, kiểm tra ngay khi gõ/dán: (1) link → thumbnail + ✓;
(2) transcript → "✓ 12 câu · 3:15" + xem trước 4 câu, cảnh báo nếu là phụ đề tự động không
dấu câu; hướng dẫn copy transcript mở sẵn cho lần đầu; (3) tên (tự lấy từ YouTube) + trình độ.
Nút "Lưu & bắt đầu học" chỉ sáng khi đủ.

**Màn học** (mobile: dọc; ≥900px hoặc điện thoại xoay ngang: transcript nằm bên phải):
- Video 16:9 → thẻ câu (thanh tiến độ trong câu, trạng thái, chữ sáng dần theo nhịp nói, câu
  kế tiếp mờ) → chế độ + tốc độ → 5 nút lớn (Câu trước · Nghe lại/Lặp câu · ▶/⏸ · Câu sau ·
  Chữ) → bản chép lời tự cuộn theo câu đang học, bấm câu nào phát câu đó, ✓ câu đã luyện.
- Đến lượt nói: thẻ viền xanh, "🎤 Đến lượt bạn", nút ▶ chuyển xanh với vòng đếm ngược.
- Cài đặt (⚙): mỗi câu phát 1–3 lần, thời gian để nói Ngắn/Vừa/Dài, tự sang câu, mở YouTube.
- Sửa câu: gộp với câu sau / tách đôi / xoá câu; tiến độ được dời theo.
- Xong bài: hộp chúc mừng + pháo giấy, "Học lại từ đầu" / "Bài khác".
- Phím tắt: Space ▶/⏸, ←/→, R nghe lại, T đổi chế độ chữ. Ẩn app → tự tạm dừng.
- Lỗi: video cấm nhúng / không tồn tại / mất mạng → thông báo rõ + "Thử lại" / "Mở trên YouTube".

**Mượt & đúng giờ**: logic chạy mỗi 50 ms, hình vẽ theo `requestAnimationFrame` (chỉ đổi
`transform`/class, không vẽ lại DOM). YouTube chỉ báo thời gian vài lần mỗi giây và báo
giờ cũ ngay sau khi tua, nên lớp bọc player giữ mốc tua cho tới khi YouTube bắt kịp và tự
nội suy thời gian giữa hai lần báo; bộ điều khiển câu còn tự tua lại nếu video không tới.

## 9. Kiểm thử

| Lớp | Công cụ | Nội dung |
|---|---|---|
| Typecheck | `npm run typecheck` | toàn bộ `src/` (chạy cả trước khi deploy) |
| Unit (75 test) | `npm test` (vitest) | đọc link YouTube; transcript YouTube copy (mốc riêng dòng/cùng dòng, nhãn "5 seconds", giờ, [Music]), .srt, .vtt (cả phụ đề tự động lặp dòng); chia câu (dấu câu, viết tắt, ngoặc kép, câu dài, khoảng lặng, phụ đề không dấu); gộp/tách/xoá; vòng luyện (khoảng nghỉ, lặp N lần, tự/không tự sang câu, tạm dừng, nghe lại khi YouTube báo giờ cũ, tua lại khi kẹt, nói đuổi, lặp câu, điều khiển từ ngoài, hết bài); lưu trữ (dữ liệu hỏng, đầy bộ nhớ, tiến độ khi số câu đổi) |
| End-to-end (21 kịch bản × mobile + desktop) | `npm run test:e2e` (Playwright, bản build thật, YouTube giả lập) | vào/ra Shadowing; tạo bài từ link + transcript dán và từ video gợi ý + file .srt; nghe & nhắc (video dừng đúng cuối câu, sang câu); tạm dừng/tiếp/nghe lại/câu trước/sau; bấm câu trong danh sách; lặp 2 lần + không tự sang câu; nói đuổi + lặp câu; chế độ chữ + tốc độ (nhớ sau khi tải lại); phím tắt; cài đặt; xong bài; sửa câu (còn sau khi tải lại); tiến độ + "Học tiếp"; ẩn app tự dừng; video cấm nhúng; mất mạng rồi thử lại; không tràn ngang; điện thoại nhỏ 360×640 vẫn thấy transcript |

**Cần thử trên máy thật** (giả lập không thay được): iPhone Safari (phát lần đầu bằng chạm,
`playsinline`), Android Chrome, tốc độ 0.5× của YouTube thật, video có quảng cáo.

## 10. Việc tiếp theo

- Phase 2: thu âm & nghe lại cạnh bản gốc; chấm điểm bằng Web Speech API (tô xanh/đỏ từng từ).
- Phase 3: chép chính tả bằng bàn phím của game; thêm từ/câu khó vào word set.
- Biến các video gợi ý thành bài dựng sẵn (cần link + transcript chuẩn).

---

## 11. Học không cần transcript (đã làm)

Dán link là học được. Không có transcript thì app không biết câu bắt đầu/kết thúc ở đâu, nên:

- **Chia theo thời gian**: khi video tải xong lần đầu, app lấy độ dài video và cắt thành
  đoạn 3 / 4 / 6 giây (⚙ Cài đặt). Mỗi đoạn hiện "🎧 Đoạn n · 0:08 – 0:12" thay cho câu chữ;
  mọi chế độ (nghe & nhắc, nói đuổi, lặp, tốc độ, gộp/tách) dùng như bình thường.
- **✂ Đánh dấu câu**: video phát từ đầu, người học bấm ✂ ngay khi người nói hết một câu
  (Space/Enter trên máy tính; "Bỏ dấu" để xoá dấu vừa bấm). App trừ 0,2 giây phản xạ, bỏ qua
  2 lần bấm cách nhau dưới 0,5 giây; phần sau dấu cuối vẫn chia theo thời gian để học tiếp.
- **Video gợi ý có link thật** (tìm qua web search, ưu tiên kênh chính thức): "▶ Học ngay"
  tạo bài không chữ và vào học luôn; "➕ Kèm transcript" mở màn tạo bài với link điền sẵn.

---

## 12. Cắt câu tốt hơn, chữ không bị che (vòng 3)

- **Đọc transcript từ ảnh chụp** (OCR trên máy bằng tesseract.js/WASM): gộp nhiều ảnh theo mốc giờ, sửa số đọc sai, báo chỗ hở. Thử trên ảnh thật: sai ~6,6%.
- **Học & đánh dấu cùng lúc** (`LiveMarker`): video chạy, bấm ✂ khi hết câu → phát lại câu đó → tới lượt người học → chạy tiếp. Lưu `liveAnchor` + các câu đã đánh dấu; phần còn lại vẫn chia theo giây.
- **Giữ video chạy khi tới lượt** (`softHold`): tắt tiếng + 0,25× thay vì pause để khung tạm dừng của YouTube không che chữ; bài không chữ bật sẵn CC. YouTube không có tham số nào tắt khung đó. Chưa thử được trên YouTube thật trong sandbox, cần thử trên điện thoại.

---

## Nguồn tham khảo

- [RecEcho: YouTube Shadowing Master](https://chromewebstore.google.com/detail/noefpifnpmfmdeaoejjbdegbpjhedhib)
- [AI Shadowing](https://hunted.space/product/ai-shadowing)
- [Dollim: YouTube Shadowing](https://mwm.ai/apps/dollim/6765796915) · [Mimi: English Shadowing](https://mwm.ai/apps/mimi-english-shadowing/6780742714) · [SpeakFox](https://mwm.ai/apps/speakfox-shadowing-english/6760902968)
- [FluentDictation](https://peerpush.com/p/fluentdictation) · [ShadowingEnglish](https://www.producthunt.com/p/speakshadow/shadowingenglish)
- [Language Reactor review (JALT)](https://jalt-publications.org/articles/28605-enhancing-functionality-youtube-and-netflix-language-reactor) · [FluentU review](https://www.fluentu.com/blog/reviews/language-reactor/)
- [ELSA Speak vs Speechling](https://www.talkdrill.com/blog/compare/elsa-speak-vs-speechling/)
- [youtube-transcript-api issue #592 — PoTokenRequired](https://github.com/jdepoix/youtube-transcript-api/issues/592)
- [YouTube timedtext 200 empty body](https://prepublish.ai/guides/youtube-timedtext-empty-response) · [Why YouTube transcript scrapers return empty strings (2026)](https://dev.to/jamhimself/why-your-youtube-transcript-scraper-started-returning-empty-strings-and-how-to-fix-it-in-2026-20ed)
- [caniuse: Speech Recognition](https://caniuse.com/speech-recognition) · [Apple SpeechAnalyzer & Web Speech (addpipe)](https://blog.addpipe.com/apple-speechanalyzer-api/)
