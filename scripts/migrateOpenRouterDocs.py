from pathlib import Path


def update_readme() -> None:
    path = Path('README.md')
    text = path.read_text(encoding='utf-8')
    text = text.replace(
        'The implementation itself is at **release 1.5.0**',
        'The implementation itself is at **release 1.6.0**',
    )
    marker = (
        '- **1.5.0** — model-run artifact integrity, CI verification, and keyless\n'
        '  rehearsal, per\n'
        '  [`documentation/MODEL_INTEGRATION_ARTIFACT_INTEGRITY_CI_REHEARSAL_BRIEF.md`](documentation/MODEL_INTEGRATION_ARTIFACT_INTEGRITY_CI_REHEARSAL_BRIEF.md)\n'
        '  (report, including every recorded amendment to that brief:\n'
        '  [`documentation/MODEL_INTEGRATION_ARTIFACT_INTEGRITY_IMPLEMENTATION_REPORT.md`](documentation/MODEL_INTEGRATION_ARTIFACT_INTEGRITY_IMPLEMENTATION_REPORT.md))\n'
    )
    addition = marker + (
        '- **1.6.0** — pinned OpenRouter Responses integration: one exact model slug,\n'
        '  one exact provider route, fallbacks disabled, parameter support required,\n'
        '  and router metadata retained as hash-bound noncanonical evidence (report:\n'
        '  [`documentation/OPENROUTER_INTEGRATION_IMPLEMENTATION_REPORT.md`](documentation/OPENROUTER_INTEGRATION_IMPLEMENTATION_REPORT.md))\n'
    )
    if '- **1.6.0** — pinned OpenRouter Responses integration' not in text:
        text = text.replace(marker, addition)
    text = text.replace('across all five\nreleases', 'across all six\nreleases')
    text = text.replace('`model-backed-npc-001` v `1.0.0`', '`model-backed-npc-001` v `1.1.0`')
    text = text.replace('`openai-mara-action-v1`', '`openrouter-mara-action-v1`')
    text = text.replace(
        'OpenAI API\nkey (live runs only',
        'OpenRouter API\nkey with sufficient credits (live runs only',
    )
    text = text.replace(
        'fill in OPENAI_API_KEY and OPENAI_MODEL',
        'fill in OPENROUTER_API_KEY, OPENROUTER_MODEL, and OPENROUTER_PROVIDER',
    )
    text = text.replace(
        'requires `OPENAI_API_KEY`/`OPENAI_MODEL` in `.env.gateway`',
        'requires `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, and `OPENROUTER_PROVIDER` in `.env.gateway`',
    )
    anchor = (
        '- **Gateway** (`gateway/`): exact envelope validation, context-hash\n'
        '  recomputation, server-owned versioned prompt (`mara-action-selection-1.0.0`),\n'
    )
    replacement = anchor + (
        '  and an explicit OpenRouter Responses adapter using the stateless\n'
        '  `/api/v1/responses` route. Every paid request names one exact model slug and\n'
        '  one exact provider slug, sends `require_parameters: true`, disables provider\n'
        '  fallbacks, and opts into OpenRouter router metadata. The actual selected\n'
        '  provider and opaque routing record are written to `routing/<requestId>.json`\n'
        '  sidecars; they are noncanonical but recursively covered by the formal bundle\n'
        '  manifest. The OpenRouter Responses API is beta, so one disposable live smoke\n'
        '  request is required before formal data collection.\n'
    )
    if 'explicit OpenRouter Responses adapter' not in text:
        text = text.replace(anchor, replacement)
    text = text.replace(
        'dispatched request. Since 1.5.0',
        'dispatched request, plus `routing/<requestId>.json` whenever OpenRouter returns routing metadata. Since 1.5.0',
    )
    path.write_text(text, encoding='utf-8')


def update_live_report() -> None:
    path = Path('documentation/MODEL_INTEGRATION_MILESTONE_001_LIVE_ACCEPTANCE_REPORT.md')
    text = path.read_text(encoding='utf-8')
    text = text.replace('`model-backed-npc-001` v `1.0.0`', '`model-backed-npc-001` v `1.1.0`')
    text = text.replace('`openai-mara-action-v1`', '`openrouter-mara-action-v1`')
    text = text.replace('Requested model (`OPENAI_MODEL`)', 'Requested model (`OPENROUTER_MODEL`)')
    row = '| Requested model (`OPENROUTER_MODEL`) | PENDING |\n'
    if 'Pinned OpenRouter provider' not in text:
        text = text.replace(
            row,
            row + '| Pinned OpenRouter provider (`OPENROUTER_PROVIDER`) | PENDING |\n',
        )
    settings = '| Gateway settings (timeout / concurrency / per-run budget / total cap) | PENDING |'
    if 'OpenRouter routing (`require_parameters`' not in text:
        text = text.replace(
            settings,
            settings
            + '\n| OpenRouter routing (`require_parameters`, fallbacks, provider allowlist) | PENDING |',
        )
    intro = (
        'The release 1.5.0 artifact-integrity work and its CI gates passed — see\n'
        '[`MODEL_INTEGRATION_ARTIFACT_INTEGRITY_IMPLEMENTATION_REPORT.md`](MODEL_INTEGRATION_ARTIFACT_INTEGRITY_IMPLEMENTATION_REPORT.md).\n'
    )
    addition = intro + (
        'The registered live route was subsequently migrated in release 1.6.0 to\n'
        'OpenRouter Responses under model experiment version 1.1.0. Formal runs must use\n'
        'one exact `OPENROUTER_MODEL`, one exact `OPENROUTER_PROVIDER`, fallbacks disabled,\n'
        'and router metadata enabled; see\n'
        '[`OPENROUTER_INTEGRATION_IMPLEMENTATION_REPORT.md`](OPENROUTER_INTEGRATION_IMPLEMENTATION_REPORT.md).\n'
    )
    if 'registered live route was subsequently migrated' not in text:
        text = text.replace(intro, addition)
    path.write_text(text, encoding='utf-8')


update_readme()
update_live_report()
