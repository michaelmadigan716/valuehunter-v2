# Incremental Vanguard snapshots

The 2026-09-08 update extends the existing 08/28/2026 ledger. It does not rebuild or replace historical lot assignments. The original full-import process remains in `../build_data.py`.

`2026-09-08.json` records manually verified Vanguard UI data without account identifiers: three newly posted ASPI purchases, the August settlement-fund dividend, nine September 8 executed orders, current holdings, and the two changed performance months. The settlement-fund reinvestment is not an additional cash outflow (consistent with the original importer).

Reproduce from the pre-update `app/swing/_data/trades.json` and run:

```sh
python3 scripts/swing/apply_snapshot.py BASELINE_JSON scripts/swing/updates/2026-09-08.json OUTPUT_JSON
```

The importer checks the baseline date to prevent repeat application, matches every open holding quantity to Vanguard, and reconciles both account values to their displayed holding balances plus broker cash. Rounded quote prices are retained for display, while broker market values are retained exactly.

September 8 fills settle September 9. Economic sale P&L is provisional: complete SMXT exits use preserved economic costs, and ASPI uses the order's HIFO method on the recorded purchase lots. Final sublot allocation/fees may differ. None of these provisional sales are added to finalized tax totals. Broker cash differs from the execution ledger by $6.56; that difference is disclosed rather than plugged into a fabricated transaction.

The next update should obtain posted transaction amounts and finalized sold lots, replace provisional entries (not append duplicates), and reconcile fees before marking those sales final. Performance is through September 4; holdings are a delayed September 8 intraday snapshot, so their totals are intentionally dated separately. The previous historical executions, closed positions, and tax estimates were checked unchanged.

Cloud research remains paused. No research settings or Always Thinking files are changed by this update.
