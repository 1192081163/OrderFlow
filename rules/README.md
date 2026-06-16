# Extract rules

These files hold business rules used by `extract.py`.

- `builder_aliases.csv`: known builder names that should not be reported as unmapped. Use `source,builder`.
- `goods_ignore_patterns.csv`: non-product descriptions that should not become Goods1/Goods2 and should not create `goods type not mapped` warnings.
- `wa_public_holidays_2026.csv`: Western Australia public holiday calendar for P/Q date calculation. Use `holiday` for non-working days. `workday` is supported if an exception is ever needed.

After changing these files, run:

```bash
/Users/dongyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m unittest /Users/dongyu/Desktop/R004/tests/test_extract_rules.py
```
