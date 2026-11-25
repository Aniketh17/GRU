// Today: this week's networking at a glance, and follow-ups that are due.
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "../lib/api.ts";
import { Card, SectionTitle } from "./ui.tsx";

export function NetworkCard() {
  const q = useQuery({ queryKey: ["net", "overview"], queryFn: api.netOverview, staleTime: 60_000 });
  const o = q.data;
  if (!o) return null;
  const empty = o.companies.total === 0 && o.people.total === 0;
  return (
    <Card>
      <SectionTitle aside={<Link to="/network" className="text-[13px] font-medium text-accent-text no-underline">Network →</Link>}>Network</SectionTitle>
      {empty ? (
        <p className="m-0 text-[13.5px] text-ink-2">Start building relationships early: add companies you’d love to work at, then talk to the people doing the work. <Link to="/network">Get started</Link></p>
      ) : (
        <p className="m-0 text-[13.5px] text-ink-2">
          {o.week.outreach} of {o.week.goals.outreach} outreach this week · {o.week.conversations} of {o.week.goals.conversations} conversations
          {o.due.length > 0 ? <> · <Link to="/network"><strong>{o.due.length} follow-up{o.due.length === 1 ? "" : "s"} due</strong></Link></> : null}
        </p>
      )}
    </Card>
  );
}
