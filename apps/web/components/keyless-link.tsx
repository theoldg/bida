import { Icon, type IconName } from "./icons";
import { copy } from "../lib/copy";

/**
 * A link to a group with no password in it — nearly always a group screen's
 * address copied out of the browser's bar, which names the group and nothing
 * more (lib/group-link.ts). "Bad link" sent people straight back to the same
 * bar for the same address, so this says where the working one comes from and
 * draws it: the group's top bar with its menu open and the invite row lit.
 *
 * The drawing is a picture, not a control — `aria-hidden`, divs rather than
 * buttons — and it borrows the real menu's classes and labels so it can't
 * drift from the thing it depicts. Only the page's content: `BadLink` in
 * chrome.tsx draws it too, and the frame around it is each caller's.
 */
export function KeylessLink() {
  const { keyless } = copy.join;
  const rows: { label: string; icon: IconName; lit?: boolean }[] = [
    { label: copy.group.copyLink, icon: "link", lit: true },
    { label: copy.group.people, icon: "users" },
    { label: copy.rates.title, icon: "fx" },
    { label: copy.group.history, icon: "clock" },
  ];
  return (
        <div className="pad keyless">
          <div className="keyless-badge"><Icon name="link" size={20} /></div>
          <h2>{keyless.empty}</h2>
          <p>{keyless.body}</p>

          <div className="keyless-fig" aria-hidden="true">
            <div className="keyless-bar">
              <span className="iconbtn"><Icon name="back" size={15} /></span>
              <span className="keyless-name">{keyless.groupName}</span>
              <span className="iconbtn keyless-lit"><Icon name="more" size={16} /></span>
            </div>
            <div className="rowmenu keyless-menu">
              {rows.map((r) => (
                <div key={r.label} className={`rowmenu-item${r.lit ? " keyless-lit" : ""}`}>
                  <Icon name={r.icon} size={15} />
                  <span>{r.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
  );
}
