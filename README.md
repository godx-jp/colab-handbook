# colab-handbook

Bộ quy ước và công cụ nhỏ để vận hành nhiều repo — nhiều phiên code song song,
người thật lẫn AI agent — mà không giẫm chân nhau.

**Nếu bạn là AI agent, dừng ở đây và đọc [`CLAUDE.md`](CLAUDE.md).**
File này dành cho con người.

*(Tài liệu chuẩn tắc — [`CONVENTIONS.md`](CONVENTIONS.md) — viết bằng tiếng Anh
để agent và tool đọc được; README này là cửa vào tiếng Việt cho anh em dev.)*

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

Một câu hỏi quyết định tất cả: **repo này có deploy production không?**

- **Không → Tier B.** Một nhánh duy nhất: `main`. Không ship gì, tag tùy chọn.
  Đa số repo nằm đây.
- **Có → Tier A.** Code merge vào `dev` (CI nhanh), thăng cấp lên `main` (chạy
  full test suite), và một tag `v*.*.*` — chỉ tag — mới deploy.

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
| [`skills/`](skills/) | Flow phiên làm việc portable (`code-start`, `code-wrap`) cài thành skill Claude Code qua `install.sh`. |

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
