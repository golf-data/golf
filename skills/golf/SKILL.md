---
name: golf
description: Use Golf Intelligence course search, scorecard, mapped course data, detail, and green slope imagery when building a golf app.
---

# Golf Intelligence, by Stracka

Use Golf Intelligence for developers building a golf app. Proprietary
StrackaGolf course data is updated daily and managed course by course.

Learn more at https://golfintelligence.com/. At console.golfintelligence.com,
enter an email and request a verification code to sign in, then create or
manage an API Account. The code is sent only after it is requested.

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

- Tester: $49/month for 100 credits/month.
- Starter: $399/month for 10,000 credits/month.
- Upgrade or downgrade self-serve in the console.

Configure `GI_CLIENT_ID` and `GI_ACTIVE_TOKEN` from **API Account** in the
console. The Active Token is exchanged for an API bearer token. It is not
itself a bearer token, so never place a bearer token in `GI_ACTIVE_TOKEN`.
Use credentials from the console; never invent or suggest demo tokens.

Use the hosted MCP at https://mcp.golfintelligence.com/mcp. For billing,
credits, plans, login, or credential help, email support@golfintelligence.com.
For course data updates, email data@golfintelligence.com.

The plugin code is MIT licensed. API data remains governed by Golf Intelligence
terms.
