// Shows an address in a readable way: name, role, shortened address and a copy button.
import { useState } from "react";
import { useApp } from "../appdata";
import { addressUrl } from "../chain";
import { shortAddress } from "../format";
import { identify, ROLE_LABEL, type Role } from "../labels";
import { useWallet } from "../wallet";
import { Check, Copy } from "./icons";

export function RoleTag({ role }: { role: Role }) {
  return <span className={`role role-${role}`}>{ROLE_LABEL[role]}</span>;
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="copy"
      aria-label={copied ? "Copied" : `Copy ${label}`}
      title={copied ? "Copied" : `Copy ${value}`}
      onClick={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          // If the browser blocks copying, the full address is still in the tooltip.
        }
      }}
    >
      {copied ? <Check /> : <Copy />}
    </button>
  );
}

export function Party({ address, compact = false }: { address: string; compact?: boolean }) {
  const { deployment, directory } = useApp();
  const { address: mine } = useWallet();
  const who = identify(directory, address);
  const isMe = mine?.toLowerCase() === address.toLowerCase();
  const href = addressUrl(deployment, address);
  return (
    <span className="party" title={`${who.detail} ${address}`}>
      {who.name !== ROLE_LABEL[who.role] && <span className="party-name">{who.name}</span>}
      <RoleTag role={who.role} />
      {isMe && <span className="you">You</span>}
      {!compact && (
        href ? (
          <a className="party-address" href={href} target="_blank" rel="noreferrer"><code>{shortAddress(address)}</code></a>
        ) : (
          <code className="party-address">{shortAddress(address)}</code>
        )
      )}
      {!compact && <CopyButton value={address} label={who.name} />}
    </span>
  );
}
