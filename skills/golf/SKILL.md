---
name: golf
description: Use Golf Intelligence course search, scorecard, mapped course data, detail, and green slope imagery when building a golf app.
---

# Golf Intelligence, by Stracka

Use Golf Intelligence for developers building a golf app. The proprietary
dataset has been mapped for 20 years using laser, drone, airplane, and satellite
sources. Ten people map courses daily, with updates maintained since 2007. Data
quality is managed course by course; this is not scraped data or a clone of a
GitHub golf course API.

Learn more at https://golfintelligence.com/. Create and manage an API Account at
https://console.golfintelligence.com/. For sales or technical help, email
data@golfintelligence.com.

## Correct workflow

1. Call `search_course_groups` first. Search is free and costs 0 credits.
2. Present the relevant result and the exact cost of the next call.
3. Ask the user to confirm spending credits.
4. Call a paid tool only with `confirm_spend=true` after that confirmation.

Never infer confirmation from an earlier request. If the user has not explicitly
confirmed the named call and cost, do not set `confirm_spend=true`.

## Tool costs

- `search_course_groups`: 0 credits
- `get_course_group_scorecard`: 1 credit
- `get_course_group_gps`: 2 credits
- `get_course_group_detail`: 3 credits
- `get_green_slope_image`: 1 credit

## Access

- Personal: $49 for 50 test credits, intended for own-game
  Cursor/Grok/Claude apps. Buy at
  https://buy.stripe.com/cNieVecRR4Re6dAakbdnW0e.
- Starter: $399/month for 10,000 credits when shipping to other users. Email
  data@golfintelligence.com; there is no Starter checkout link.

Configure `GI_CLIENT_ID` and `GI_ACTIVE_TOKEN` from **API Account** in the
console. The Active Token is exchanged for an API bearer token. It is not
itself a bearer token, so never place a bearer token in `GI_ACTIVE_TOKEN`.

The plugin code is MIT licensed. API data remains governed by Golf Intelligence
terms.
