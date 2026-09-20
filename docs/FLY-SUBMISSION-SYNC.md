# Fly submission sync (2026-09-19)

These changes match what is already live on Fly for the OpenAI `golf` review.

- OAuth authorize CSP allows validated ChatGPT callback origin (+ platform.openai.com when callback is chatgpt.com)
- Compact course tool presentation (`src/presentation.ts`); raw payload in `_meta.golfRawResult`
- Public demo at `/demo/` — HTML and `golf-chatgpt-submission.mp4` are in git (`public/demo/`)
- Dockerfile copies `public/demo` into the image; the build-time curl of the mp4 is gone. Runtime stage only needs `su-exec` (not curl).

**Do not redeploy** while OpenAI review is pending unless Chase GO — live demo: https://mcp.golfintelligence.com/demo/

No global `GI_CLIENT_ID` / `GI_ACTIVE_TOKEN` on Fly.
