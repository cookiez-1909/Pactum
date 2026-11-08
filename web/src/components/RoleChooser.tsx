// Picks "why are you here" in plain words, so newcomers do not have to guess where to click.
import { Mascot } from "./Mascot";

const ROLES = [
  { id: "lost", art: <Mascot action="sad" size={112} />, title: "I lost money in a hack", body: "See if you are owed a refund and claim it.", action: "Check my refund" },
  { id: "holding", art: <Mascot action="sneak" size={112} />, title: "I'm holding the stolen funds", body: "Send them back and keep the published reward.", action: "See my options" },
  { id: "team", art: <Mascot action="alarm" size={112} />, title: "My protocol was hacked", body: "Get verified and publish an offer.", action: "Start here" },
  { id: "explore", art: <Mascot action="look" size={112} />, title: "I'm just looking", body: "Browse the cases. Nothing here is real money.", action: "Browse cases" },
];

export function RoleChooser() {
  return (
    <ul className="role-chooser">
      {ROLES.map((role) => (
        <li key={role.id}>
          <a className="role-card" href={`#/start/${role.id}`}>
            <span className="role-art">{role.art}</span>
            <span className="role-title">{role.title}</span>
            <span className="role-body">{role.body}</span>
            <span className="role-action">{role.action} →</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
