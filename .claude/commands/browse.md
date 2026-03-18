# Browser Automation Skill

You have access to a real Chrome browser via Oya Browser MCP tools. Use them to browse the web, interact with pages, and complete tasks the user asks for.

## Available Tools

| Tool | Purpose |
|------|---------|
| `analyze_page` | Read the current page — returns markdown with numbered interactive elements `[#id type "label"]` |
| `navigate` | Go to a URL |
| `click` | Click element by `element_id` (the `#id` number from analyze) |
| `type` | Type text into an input by `element_id` — clears existing content first |
| `screenshot` | Capture what's currently visible as a PNG image |
| `scroll` | Scroll `up` or `down` by pixel amount (default 500) |
| `wait` | Wait for a CSS selector to appear (with timeout) |
| `read_elements` | Lightweight list of interactive elements (no full page markdown) |

## Core Workflow

Always follow this loop:

```
1. analyze_page → understand what's on screen
2. Act (click / type / scroll / navigate)
3. analyze_page again → verify the result
```

Never click or type blindly. Always analyze first to get element IDs.

## Rules

- **Always analyze before acting.** Element IDs change on every analyze call. Never reuse IDs from a previous analysis.
- **Use the element index.** The "Visible" section shows what's on screen now. The "Off-screen" section shows what needs scrolling.
- **After clicking a link or button, re-analyze.** The page content changes — old element IDs are invalid.
- **After typing, verify.** Re-analyze or screenshot to confirm the text was entered correctly.
- **Scroll to reveal off-screen elements.** If the element you need is in the "Off-screen" list, scroll down first, then re-analyze to get its new ID.
- **Use screenshot sparingly.** Screenshots are large. Use analyze_page for structured data, screenshots only when you need to see visual layout, images, or verify rendering.
- **Read the metadata header.** Every analysis starts with `url:`, `title:`, `viewport:`, `scroll:`, `elements:` — use scroll % to know your position on the page.
- **Handle pagination/infinite scroll.** If content is truncated, scroll down and re-analyze to load more.

## Patterns

### Fill a form
```
1. analyze_page
2. For each field: type(element_id, value)
3. click the submit button
4. analyze_page to check result
```

### Search for something
```
1. analyze_page → find the search input
2. type(search_input_id, "query")
3. click search button OR type Enter via click on a submit
4. analyze_page → read results
```

### Navigate multi-page content
```
1. analyze_page → read content
2. scroll(down) if more content below (check scroll %)
3. analyze_page → read next section
4. Repeat until scroll reaches ~100% or content ends
```

### Click a specific item in a list
```
1. analyze_page → find the element with matching text in the element index
2. If it's off-screen, scroll until it's visible, re-analyze
3. click(element_id)
4. analyze_page → verify navigation
```

### Handle dropdowns / selects
```
1. analyze_page → find the select element
2. click(select_id) → opens the dropdown
3. analyze_page → find the option elements
4. click(option_id)
```

## Pool Mode

If connected to `/mcp/pool` instead of `/mcp/:browserId`, commands are round-robined across all browsers in the pool:
- `navigate` and `analyze_page` advance to the **next** browser
- `click`, `type`, `screenshot`, etc. stay **pinned** to the last-used browser
- Each response includes a browser tag like `[Browser-1 abc12345]`
- Use `pool_status` tool to see how many browsers are connected
- Cookies are synced across all pool browsers automatically

## Tips

- `[#5 link "Settings" → /settings]` — element #5 is a link labeled "Settings" pointing to /settings. Use `click(element_id=5)`.
- `[#12 input:email placeholder="you@example.com" required]` — element #12 is a required email input. Use `type(element_id=12, text="user@example.com")`.
- `[#8 ☑ "Remember me"]` — element #8 is a checked checkbox. Click to uncheck.
- `[#3 button "Submit" disabled]` — element #3 is disabled. Fill required fields first.
- `<!-- nav -->...<!-- /nav -->` — landmarks tell you which part of the page you're in (nav, main, footer, etc.).
- If analyze returns a very long result, focus on the element index at the bottom to find what you need quickly.

## User Request

$ARGUMENTS
