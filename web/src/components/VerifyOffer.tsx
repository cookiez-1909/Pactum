// Checks before returning funds. The first three rows read real data in the browser; the last one the viewer must do.
// A fake page can draw green checks too, so this box does not replace checking elsewhere.
import { useEffect, useMemo, useState } from "react";
import proof from "../../../deployments/sepolia.json";
import baseProof from "../../../deployments/base-sepolia.json";
import robinhoodProof from "../../../deployments/robinhood-testnet.json";
import registry from "../../../deployments/registry.json";
import { useApp } from "../appdata";
import { addressUrl, checkRefundList, fetchNearProposal, nearAmount, nearView, type CaseInfo, type RegistryOperator } from "../chain";
import { CopyButton } from "./Party";
import { Check, ExternalLink } from "./icons";
import { shortAddress, tokens } from "../format";

type Result = "good" | "bad" | "neutral" | "waiting";

const OFFICIAL_CONTRACTS = [proof, baseProof, robinhoodProof].map((item) => item.contracts.Pactum.toLowerCase());

function Row({ result, title, children }: { result: Result; title: string; children: React.ReactNode }) {
  return (
    <li className={`verify-row is-${result}`}>
      <span className="verify-mark" aria-hidden="true">{result === "good" ? <Check /> : result === "bad" ? "!" : "–"}</span>
      <div>
        <p className="verify-title">{title}</p>
        <p className="verify-body">{children}</p>
      </div>
    </li>
  );
}

export function VerifyOffer({ info }: { info: CaseInfo }) {
  const { deployment } = useApp();
  const local = deployment.network === "local";
  const pactum = deployment.contracts.Pactum;
  const official = OFFICIAL_CONTRACTS.includes(pactum.toLowerCase());
  const list = useMemo(() => checkRefundList(info.allocations, info.terms.refundRoot, BigInt(info.terms.totalLoss)), [info.allocations, info.terms.refundRoot, info.terms.totalLoss]);
  const [near, setNear] = useState<{ result: Result; text: string }>({ result: "waiting", text: "Reading NEAR…" });
  const [stake, setStake] = useState<{ result: Result; text: string }>({ result: "waiting", text: "Reading NEAR…" });
  const explorer = addressUrl(deployment, pactum);
  const officialPost = info.evidence?.offer?.officialPost;

  useEffect(() => {
    if (deployment.near.simulated) {
      setNear({ result: "neutral", text: "Simulated in this local demo. A test key stands in for the guardians." });
      return;
    }
    let cancelled = false;
    fetchNearProposal(deployment)
      .then((proposal) => {
        if (cancelled) return;
        const listed = proposal?.cases.some((item) => item.terms.case_id === info.terms.caseId);
        setNear(listed ? { result: "good", text: `Proposal ${proposal!.id}, approved by ${proposal!.approvals.length} guardians.` } : { result: "bad", text: "This case is not in the proposal on NEAR." });
      })
      .catch(() => !cancelled && setNear({ result: "waiting", text: "Could not read NEAR." }));
    return () => {
      cancelled = true;
    };
  }, [deployment, info.terms.caseId]);

  // The operator must have a stake in the registry. A fork without a stake is not listed here.
  useEffect(() => {
    const controller = deployment.near.controllerAccount;
    if (deployment.near.simulated || !controller) {
      setStake({ result: "neutral", text: "Simulated in this local demo. The Guardians page shows the real stake on NEAR testnet." });
      return;
    }
    let cancelled = false;
    Promise.all([nearView<boolean>(registry.registry, "is_listed", { controller }), nearView<RegistryOperator>(registry.registry, "get_operator", { controller })])
      .then(([listed, operator]) => {
        if (cancelled) return;
        if (!operator) return setStake({ result: "bad", text: "This operator has no stake in the registry." });
        const slashed = BigInt(operator.total_slashed) > 0n ? ` It has been slashed ${nearAmount(operator.total_slashed)} before.` : "";
        setStake(listed ? { result: "good", text: `${nearAmount(operator.stake)} staked, and it loses that if the council finds fraud.${slashed}` } : { result: "bad", text: `Not listed: the stake was withdrawn, slashed or is below the minimum.${slashed}` });
      })
      .catch(() => !cancelled && setStake({ result: "waiting", text: "Could not read NEAR." }));
    return () => {
      cancelled = true;
    };
  }, [deployment]);

  return (
    <section className="card verify-offer">
      <h2>Verify this offer</h2>
      <ol className="verify-list">
        <Row result={local ? "neutral" : official ? "good" : "bad"} title="Contract is on the official list">
          {local ? "Simulated in this local demo, where the contract is deployed fresh." : official ? "This address is in Pactum's published list." : "This address is not in Pactum's published list."}{" "}
          <code>{shortAddress(pactum)}</code> <CopyButton value={pactum} label="contract address" />
          {explorer && <> <a href={explorer} target="_blank" rel="noreferrer"><ExternalLink /></a></>}
        </Row>
        <Row result={stake.result} title="Operator has money at stake">{stake.text}</Row>
        <Row result={near.result} title="Approved by guardians on NEAR">{near.text}</Row>
        <Row result={list.ok ? "good" : "bad"} title="Refund list matches the signed terms">
          {list.ok
            ? `${list.wallets} wallets add up to the total loss of ${tokens(BigInt(info.terms.totalLoss), info.token.decimals, 2)} ${info.token.symbol}, and every proof matches the signed root. This cannot tell whether those wallets really lost funds.`
            : list.reason}
        </Row>
        <Row result="neutral" title="Published by the protocol itself">
          {officialPost ? `Linked in this offer: ${officialPost}. ` : ""}Open the protocol&rsquo;s official account yourself, and look for this contract address and the offer&rsquo;s code. Simulated here, because these protocols are fictional.
        </Row>
      </ol>
      <p className="fine-print"><strong>A fake site can show the same checks.</strong> Compare the address on a block explorer and on the protocol&rsquo;s own account, not only here.</p>
    </section>
  );
}
