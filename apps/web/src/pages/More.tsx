// Mobile "More" tab: sections that don't fit in the bottom bar.
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { InboxIcon, NoteIcon, PeopleIcon, SettingsIcon } from "../components/Icons.tsx";
import { Card, PageHeader } from "../components/ui.tsx";
import { api } from "../lib/api.ts";

export function MorePage() {
  const brief = useQuery({ queryKey: ["brief"], queryFn: api.brief });
  const inbox = useQuery({ queryKey: ["inboxCount"], queryFn: api.inboxCount });
  const items = [
    { to: "/insights", label: "Insights", note: "Funnel, replies, skills in demand", icon: NoteIcon },
    { to: "/network", label: "Network", note: "Companies and people to learn from", icon: PeopleIcon },
    { to: "/inbox", label: "Inbox", note: inbox.data?.count ? `${inbox.data.count} to sort` : "Mail GRU couldn’t classify", icon: InboxIcon },
    { to: "/review", label: "Review", note: brief.data?.review_count ? `${brief.data.review_count} waiting` : "Emails GRU wasn’t sure about", icon: InboxIcon },
    { to: "/notes", label: "Notes", note: "Quick capture and search", icon: NoteIcon },
    { to: "/people", label: "Recruiters", note: "Recruiters and hiring contacts", icon: PeopleIcon },
    { to: "/settings", label: "Settings", note: "Gmail, resume, daily loop, export, pause", icon: SettingsIcon },
  ];
  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4">
      <PageHeader title="More" />
      <Card className="overflow-hidden">
        <ul className="m-0 list-none p-0">
          {items.map(({ to, label, note, icon: Icon }) => (
            <li key={to} className="border-t border-line first:border-t-0">
              <Link to={to} className="flex items-center gap-3 px-5 py-3.5 text-ink no-underline hover:bg-sunken">
                <Icon size={19} />
                <span className="flex flex-col"><span className="font-semibold">{label}</span><span className="text-[12.5px] text-muted">{note}</span></span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
