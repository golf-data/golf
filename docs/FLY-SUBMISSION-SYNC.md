# Fly submission sync (2026-09-19)

These changes match what is already live on Fly for the OpenAI `golf` review.

- OAuth authorize CSP allows validated ChatGPT callback origin (+ platform.openai.com when callback is chatgpt.com)
- Compact course tool presentation (`src/presentation.ts`); raw payload in `_meta.golfRawResult`
- Public demo at `/demo/` — HTML is in git; the ~8MB `golf-chatgpt-submission.mp4` is still Fly-only
- Dockerfile runtime stage curls the live mp4 into `public/demo/` during image build so a redeploy cannot wipe the video while the previous machine still serves it

**Do not redeploy** while OpenAI review is pending unless Chase GO — live demo: https://mcp.golfintelligence.com/demo/

Preferred follow-up: commit the mp4 binary into `public/demo/` and drop the build-time curl.

No global `GI_CLIENT_ID` / `GI_ACTIVE_TOKEN` on Fly.
