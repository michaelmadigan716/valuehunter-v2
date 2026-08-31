export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const sp = await searchParams;
  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <form action="/api/swing/login" method="post" className="card p-8 w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-lg font-semibold">Swing Trade Hunter</h1>
          <p className="text-sm text-ink-2">This page is private. Enter the access password.</p>
        </div>
        <input type="hidden" name="next" value={sp.next ?? "/swing"} />
        <input
          type="password"
          name="password"
          placeholder="Password"
          autoFocus
          required
          className="w-full"
          aria-invalid={sp.error ? true : undefined}
        />
        {sp.error && <p className="text-sm text-loss">That password didn&apos;t match.</p>}
        <button className="btn w-full" type="submit">
          Continue
        </button>
      </form>
    </div>
  );
}
