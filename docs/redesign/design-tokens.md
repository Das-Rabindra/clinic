# Design tokens

Populated in Stage 2. Pre-checks done during the audit (WCAG relative-luminance
ratios):

| Pair | Ratio | Use |
|---|---|---|
| white on `--primary #155E59` | 7.56 | primary button text ✔ |
| `--primary` on `--bg #F8F7F2` | 7.05 | links ✔ |
| `--text #252E2C` on `--bg` | 13.0 | body ✔ |
| `--accent-sage #DDEAE3` vs `--bg` | 1.15 | decorative only, as specified |
| `--accent-sand #E9DCCB` vs `--bg` | 1.26 | decorative only, as specified |

Current values that fail and must not carry over:

| Current value | Ratio | Problem |
|---|---|---|
| honey focus ring `#C79A4B` on paper | 2.43 | below 3:1 |
| input border `#E4DFD3` on white | 1.33 | below 3:1 |
| meta text `#7C8A78` on white | 3.64 | below 4.5:1 |
| optional label `#8A948A` | 3.14 | below 4.5:1 |
