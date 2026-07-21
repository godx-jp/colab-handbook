[English](README.md) · ***Tiếng Việt***

# colab-handbook

Bộ quy ước và công cụ nhỏ để vận hành nhiều repo — nhiều phiên code song song,
người thật lẫn AI agent — mà không giẫm chân nhau.

**Nếu bạn là AI agent, dừng ở đây và đọc [`CLAUDE.md`](CLAUDE.md).**
File này dành cho con người.

*(Tài liệu chuẩn tắc — [`CONVENTIONS.md`](CONVENTIONS.md) — viết bằng tiếng Anh
để agent và tool đọc được. Bản này là cửa vào tiếng Việt cho anh em dev; bản
tiếng Anh nằm ở [`README.md`](README.md). Cả hai chỉ là cửa vào, không phải
tài liệu chuẩn tắc — khi hai bản nói khác nhau thì **cả hai đều sai** cho tới
khi khớp lại với `CONVENTIONS.md`.)*

## Đây là cái gì

Một cuốn **handbook, không phải framework**. Nó quyết định **kết quả** — code
merge vào đâu, release là gì, báo "tôi đang làm việc này" bằng cách nào — và cố
tình để **cách hiện thực** (phiên bản Node, test runner, file CI của bạn) cho
từng repo tự quyết.

Mọi thứ trong đây được chưng cất từ việc vận hành ~25 repo thật, trong đó có
nhiều app production được bảo trì gần như hoàn toàn bởi AI agent chạy song song
trên nhiều worktree. Mục anti-pattern không phải lý thuyết: từng mục là chuyện
đã xảy ra thật, kèm sẹo để chứng minh.

## Mô hình trong 30 giây

Hai câu hỏi quyết định tất cả: **repo này có deploy production không — và nếu
có, cái gì chặn giữa merge và người dùng?**

- **Không → Tier B.** Một nhánh duy nhất: `main`. Không ship gì, tag tùy chọn.
  Đa số repo nằm đây. **0 cổng.**
- **Có, và chính lần promote là deploy → Tier C.** Code merge vào `dev` (CI
  nhanh), promote `dev` → `main` — và cú push `main` đó *chính là* deploy.
  Không có tag. **1 cổng.** Hợp với site đang chạy thật nhưng nhẹ đô, nơi nghi
  thức tag chẳng ai giữ.
- **Có, và một tag mới deploy → Tier A.** Code merge vào `dev` (CI nhanh),
  thăng cấp lên `main` (chạy full test suite), và một tag `v*.*.*` — chỉ tag —
  mới deploy. **2 cổng.**

**A/B/C là nhãn, không phải điểm số.** Đọc lướt dễ tưởng C "tệ hơn" B, nhưng B
không có production nào cả. Chữ cái mô tả *hình dạng* pipeline, không phải mức
độ nghiêm túc — chọn cái đúng với sự thật của repo mình.

Mỗi repo khai báo mình thuộc tier nào trong `.github/project.yml`, nên không ai
phải đoán. Issue được **claim** bằng assignee + label `in-progress` trước khi
bắt tay vào làm, nên các phiên song song không bao giờ đụng nhau trên cùng một
việc.

Toàn bộ luật: [`CONVENTIONS.md`](CONVENTIONS.md). Đọc mất ~15 phút và là file
**chuẩn tắc duy nhất** — mọi thứ còn lại trong repo chỉ phục vụ nó.

## Cấu trúc repo

| Đường dẫn | Là gì |
|---|---|
| [`CONVENTIONS.md`](CONVENTIONS.md) | Luật. Chuẩn tắc, nguồn sự thật duy nhất (EN). |
| [`CLAUDE.md`](CLAUDE.md) | Cửa vào cho AI agent — bản chưng cất vận hành (EN). |
| [`project.schema.md`](project.schema.md) | Tham chiếu field của `.github/project.yml`. |
| [`templates/`](templates/) | Điểm khởi đầu **copy-về-là-của-bạn**: CI, release, block `CLAUDE.md` cho repo adopt. **Không có gì được gọi từ xa** — copy, sửa, sở hữu. |
| [`tools/`](tools/) | `colab` — một CLI nhỏ cho claim issue, cấp port, và quản lý worktree (tùy chọn). State JSON, không dependency. |
| [`audit/`](audit/) | Trình kiểm tra conformance từ bên ngoài. Đọc mọi repo của bạn — mọi owner, kể cả repo local-only — và báo drift trong một lần chạy. Chỉ cảnh báo, không bao giờ chặn. |
| [`skills/`](skills/) | Flow phiên làm việc portable: `code-triage` (chọn việc tiếp theo) → `code-start` (mở phiên) → `code-wrap` (ship + chưng cất), cộng `code-sweep` (dọn sạch mọi việc ĐÃ XONG trong một repo, chạy code-wrap từng cái) và `handbook-sync` (kéo MỘT repo lên bản handbook mới nhất, chạy từ trong repo đó). [`install.sh`](install.sh) cài chúng thành skill Claude Code — xem mục *Cài đặt máy* ngay dưới. |
| [`install.sh`](install.sh) | Cài đặt cho **máy của bạn**: skills, CLI `colab`, hook pre-commit, danh sách repo cho audit. Idempotent, và `--dry` cho xem trước mọi thứ. |

## Cài đặt máy

Làm một lần cho mỗi máy, trước khi adopt handbook vào repo nào.

**Cần có sẵn:** `git`; `node` ≥ 18 (`.nvmrc` ghim 22 — đúng bản CI ở đây chạy);
`gh` và phải **đăng nhập rồi** (`gh auth login`) — claim issue, các skill và
phần audit repo remote đều vô dụng nếu thiếu, mà lỗi thì mãi về sau mới hiện ra
dưới dạng khó hiểu; `gitleaks` chỉ cần nếu bạn muốn bật hook pre-commit.
`install.sh` kiểm tra hết những thứ này và báo cái nào thiếu *trước khi* đụng
vào bất cứ gì.

**1. Clone vào chỗ ở lâu dài** — để chung với đống code của bạn, đừng để trong
thư mục tạm.

```sh
git clone https://github.com/godx-jp/colab-handbook.git ~/code/colab-handbook
cd ~/code/colab-handbook
```

**Bản clone này là hạ tầng, không phải file tải về xem cho biết.** Các skill
được cài bằng symlink trỏ *thẳng vào working tree này*: xoá clone đi là mọi
phiên trên máy mất skill, và repo đang checkout nhánh nào thì mọi phiên dùng
đúng bản skill của nhánh đó. Nên khi không trực tiếp sửa handbook, hãy để nó ở
`main`. `install.sh` sẽ cảnh báo nếu thấy mình đang nằm trong `/tmp`,
`~/Downloads` hay `~/Desktop`.

**2. Cài.**

```sh
./install.sh --all --dry   # xem trước sẽ làm gì; không thay đổi gì cả
./install.sh --all         # skills + CLI colab + hook pre-commit + danh sách repo
```

`--all` là lựa chọn nên dùng cho lần chạy đầu. Mọi thứ nó làm đều là symlink
hoặc copy, chạy lại bao nhiêu lần cũng được, và không bao giờ ghi đè thứ nó
không tạo ra — skill của riêng bạn, hay `~/.colab/repos.txt` đã có sẵn, đều được
giữ nguyên kèm một dòng cảnh báo. Chạy trơn `./install.sh` thì chỉ cài skills,
nếu bạn thật sự chỉ cần bấy nhiêu.

| Flag | Làm gì |
|---|---|
| *(không có)* | Symlink `skills/` vào `~/.claude/skills/`, để mở repo nào cũng có. |
| `--tools` | Symlink CLI `colab` vào `~/.local/bin/colab`, và kiểm tra thư mục đó có thật sự nằm trong `PATH` không — thiếu thì in ra đúng dòng cần thêm. |
| `--hooks` | Trỏ git của clone này vào `.githooks/` (pre-commit chạy gitleaks). `core.hooksPath` nằm trong `.git/config` nên là cấu hình per-clone, per-máy, không đi theo repo. |
| `--fleet` | Tạo `~/.colab/repos.txt` từ `audit/repos.txt`, chỉ khi file chưa tồn tại. Danh sách đó cố tình nằm ngoài repo: nó ghi tên các repo private của bạn, còn repo này thì public. |
| `--all` | `--tools --hooks --fleet`. |
| `--dry` | In ra sẽ làm gì, không thay đổi gì. Ghép được với mọi flag trên. |

**3. Kiểm lại, rồi chỉ cho audit biết phải soi repo nào.**

```sh
colab --help                 # không thấy lệnh? sửa PATH — bước 2 in sẵn dòng cần thêm
$EDITOR ~/.colab/repos.txt   # thay các dòng ví dụ bằng repo của bạn
node audit/audit.mjs         # báo cáo conformance cho toàn bộ fleet
```

Xong thì đọc [`CONVENTIONS.md`](CONVENTIONS.md): mất ~15 phút, và là file chuẩn
tắc duy nhất ở đây.

## Adopt vào một repo

Bản rút gọn — checklist đầy đủ ở
[`CONVENTIONS.md` §9](CONVENTIONS.md#9-adopting-this):

1. Xác định tier một cách trung thực (có production **hôm nay** không, chứ
   không phải "sắp có").
2. Thêm `.github/project.yml`.
3. `gh label create in-progress` — label claim chưa tồn tại sẵn đâu.
4. Dán [`templates/repo-CLAUDE-block.md`](templates/repo-CLAUDE-block.md) vào
   `CLAUDE.md` của repo — đây là cách duy nhất để agent phát hiện ra bộ quy ước
   này.
5. Đảm bảo CI đạt hai kết quả bắt buộc: quét secret và build, với phiên bản
   toolchain **resolve từ manifest của chính repo** — không bao giờ hardcode.
   Copy template nếu thấy tiện.

Nhánh có sẵn từ trước được **giữ nguyên** (grandfathered). Đừng đổi tên gì cả.

## Vì sao ép buộc ít vậy

Các repo private của chúng ta nằm trên gói GitHub không có branch protection —
không thể cấm push vào `main`. Nên handbook này không giả vờ ép buộc; nó làm
cho việc **tuân thủ rẻ và việc kiểm tra rẻ**. Audit tool báo drift; quy ước
giải thích *vì sao* từng luật tồn tại để bạn tự phán đoán khi nào đáng phá luật.
Khi phá, hãy sửa tài liệu trong cùng PR — một tài liệu mô tả một repo không tồn
tại là thứ tệ nhất trong nghề này.
