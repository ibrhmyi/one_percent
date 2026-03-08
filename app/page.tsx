import { MarketDashboard } from "@/components/market-dashboard";
import { getClosingSoonMarkets, getEventFamilyMarkets } from "@/lib/market-service";

export const dynamic = "force-dynamic";

type HomeProps = {
  searchParams?: Promise<{
    event?: string | string[];
    eventSlug?: string | string[];
    eventUrl?: string | string[];
  }>;
};

function firstParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

export default async function Home({ searchParams }: HomeProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const initialNow = Date.now();
  const eventInput =
    firstParam(resolvedSearchParams?.event) ??
    firstParam(resolvedSearchParams?.eventSlug) ??
    firstParam(resolvedSearchParams?.eventUrl);
  const snapshot = eventInput
    ? await getEventFamilyMarkets(eventInput)
    : await getClosingSoonMarkets();

  return (
    <MarketDashboard
      initialResponse={snapshot}
      eventInput={eventInput}
      initialNow={initialNow}
    />
  );
}
