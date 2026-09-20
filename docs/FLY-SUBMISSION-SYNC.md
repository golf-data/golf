# Fly submission sync (2026-09-19)

These changes match what is already live on Fly for the OpenAI `golf` review.

- OAuth authorize CSP allows validated ChatGPT callback origin (+ platform.openai.com when callback is chatgpt.com)
- Compact course tool presentation (`src/presentation.ts`); raw payload in `_meta.golfRawResult`
- Public demo at `/demo/` — commit `public/demo/golf-chatgpt-submission.mp4` from live https://mcp.golfintelligence.com/demo/golf-chatgpt-submission.mp4 if missing

**Do not redeploy** while OpenAI review is pending unless Chase GO — live demo: https://mcp.golfintelligence.com/demo/

No global `GI_CLIENT_ID` / `GI_ACTIVE_TOKEN` on Fly.
