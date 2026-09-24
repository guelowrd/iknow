import { useCallback, useState } from "react";
import { useCompile, useMiden, useMidenClient, useTransaction } from "@miden-sdk/react";
import { useMidenFiWallet } from "@miden-sdk/miden-wallet-adapter-react";
import { Transaction } from "@miden-sdk/miden-wallet-adapter-base";
import { buildStakeNote, markRelayed, newDraft, potAddress, potComponent, savePosition, stakeRequest, STAKE_MASM, type Market, type Position } from "@/lib/iknow";
import type { Session } from "./useSession";

export type BetStatus = "idle" | "building" | "signing" | "relaying" | "sent" | "error";

export function useBet(session: Session, onPlaced: (p: Position) => void) {
  const { runExclusive } = useMiden();
  const client = useMidenClient();
  const compile = useCompile();
  const tx = useTransaction();
  const bread = useMidenFiWallet();
  const [status, setStatus] = useState<BetStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  /** Hands one of this client's own private output notes to the pot through the transport service. */
  const relayOutputNote = useCallback(
    async (noteId: string, pot: string) => {
      await runExclusive(() => client.sendPrivateOutputNote(noteId, potAddress(pot)));
      markRelayed(noteId);
    },
    [runExclusive, client],
  );

  const placeBet = useCallback(
    async (market: Market, side: 1 | 2, units: number) => {
      if (!session.address) return;
      setError(null);
      setStatus("building");
      try {
        const draft = newDraft(market.id, session.address, side, units);
        const script = await runExclusive(async () => compile.noteScript({ code: STAKE_MASM, libraries: [{ component: await potComponent() }] }));
        const noteId = buildStakeNote(script, draft).id().toString();
        let txId: string | undefined;

        if (session.mode === "bread") {
          if (!bread.requestTransaction) throw new Error("Bread wallet does not expose requestTransaction");
          setStatus("signing");
          const request = stakeRequest(buildStakeNote(script, draft));
          const recipient = potAddress(market.id).toBech32((await import("@miden-sdk/miden-sdk")).NetworkId.testnet());
          txId = await bread.requestTransaction(Transaction.createCustomTransaction(session.address, recipient, request));
          setStatus("relaying");
          await bread.waitForTransaction?.(txId, 180_000).catch(() => undefined);
          await runExclusive(async () => {
            await client.syncState();
            const height = await client.getSyncHeight();
            await client.sendPrivateNote(buildStakeNote(script, draft), potAddress(market.id), Math.max(0, height - 50));
          });
        } else {
          setStatus("signing");
          // privateNoteTarget on tx.execute crashes in the SDK's commit wait (TransactionFilter.ids), so relay by hand.
          const result = await tx.execute({ accountId: session.address, request: stakeRequest(buildStakeNote(script, draft)) });
          txId = result.transactionId;
        }

        const position: Position = { market: market.id, side, units, salt: draft.salt, noteId, txId, at: Date.now(), wallet: session.address, state: "pending" };
        savePosition(position);
        onPlaced(position);
        if (session.mode === "guest") {
          setStatus("relaying");
          await relayOutputNote(noteId, market.id);
        }
        setStatus("sent");
        session.refreshBalance().catch(() => undefined);
      } catch (err) {
        console.error("bet failed", err);
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    },
    [session, runExclusive, compile, client, bread, tx, onPlaced, relayOutputNote],
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
  }, []);

  return { placeBet, status, error, reset, relayOutputNote };
}
