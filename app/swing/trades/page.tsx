import { TradeLog } from "@/app/swing/_components/TradeLog";
import { data } from "@/app/swing/_lib/data";

export default function TradesPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Trade log</h1>
        <p className="text-sm text-ink-2 mt-1">
          Every buy and sell execution, newest first. Realized P&amp;L on a sell is the gain on the lots Vanguard assigned to it, at original cost.
        </p>
      </div>
      <TradeLog executions={data.executions} />
    </div>
  );
}
