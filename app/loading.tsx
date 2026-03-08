function LoadingCard() {
  return (
    <div className="card-border animate-pulse rounded-3xl p-5 shadow-panel">
      <div className="mb-4 h-4 w-24 rounded-full bg-white/10" />
      <div className="mb-3 h-6 w-3/4 rounded-full bg-white/10" />
      <div className="mb-6 h-4 w-1/2 rounded-full bg-white/5" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="h-16 rounded-2xl bg-white/5" />
        <div className="h-16 rounded-2xl bg-white/5" />
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 py-10">
      <div className="mb-10 space-y-3">
        <div className="h-3 w-24 animate-pulse rounded-full bg-white/10" />
        <div className="h-10 w-72 animate-pulse rounded-full bg-white/10" />
        <div className="h-4 w-[32rem] max-w-full animate-pulse rounded-full bg-white/5" />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <LoadingCard />
        <LoadingCard />
        <LoadingCard />
      </div>

      <div className="mt-8 grid gap-4 xl:grid-cols-2">
        {Array.from({ length: 6 }).map((_, index) => (
          <LoadingCard key={index} />
        ))}
      </div>
    </main>
  );
}
