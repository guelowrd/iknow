import { useCallback, useState } from "react";
import { useCompile, useConsume, useMiden, useMidenClient, useSend, useTransaction } from "@miden-sdk/react";
import { useMidenFiWallet } from "@miden-sdk/miden-wallet-adapter-react";
import { Transaction } from "@miden-sdk/miden-wallet-adapter-base";
import { Address, NetworkId } from "@miden-sdk/miden-sdk";
import { MIDEN_FAUCET, UNIT } from "@/config";
import {
  buildStakeNote, draftOf, markRelayed, newDraft, parseId, potAddress, potComponent, removePosition, savePosition,
  stakeRequest, STAKE_MASM, type Market, type Position,
} from "@/lib/iknow";
import type { Session } from "./useSession";

export type PredictStatus = "idle" | "building" | "signing" | "relaying" | "sent" | "error";

export function usePrediction(session: Session, onPlaced: (p: Position) => void) {
  const { runExclusive } = useMiden();
  const client = useMidenClient();
  const compile = useCompile();
  const tx = useTransaction();
  const consume = useConsume();
  const sendHook = useSend();
  const bread = useMidenFiWallet();
  const [status, setStatus] = useState<PredictStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const script = useCallback(
    () => runExclusive(async () => compile.noteScript({ code: STAKE_MASM, libraries: [{ component: await potComponent() }] })),
    [runExclusive, compile],
  );

  /** Hands one of this client's own private output notes to an address through the transport service. */
  const relayOutputNote = useCallback(
    async (noteId: string, to: string) => {
      await runExclusive(() => client.sendPrivateOutputNote(noteId, Address.fromAccountId(parseId(to))));
      markRelayed(noteId);
    },
    [runExclusive, client],
  );

  const predict = useCallback(
    async (market: Market, side: 1 | 2, units: number) => {
      if (!session.address) return;
      setError(null);
      setStatus("building");
      try {
        const draft = newDraft(market.id, session.address, side, units);
        const noteScript = await script();
        const noteId = buildStakeNote(noteScript, draft).id().toString();
        let txId: string | undefined;

        if (session.mode === "bread") {
          if (!bread.requestTransaction) throw new Error("Bread wallet does not expose requestTransaction");
          setStatus("signing");
          const request = stakeRequest(buildStakeNote(noteScript, draft));
          const recipient = potAddress(market.id).toBech32(NetworkId.testnet());
          txId = await bread.requestTransaction(Transaction.createCustomTransaction(session.address, recipient, request));
          setStatus("relaying");
          await bread.waitForTransaction?.(txId, 180_000).catch(() => undefined);
          await runExclusive(async () => {
            await client.syncState();
            const height = await client.getSyncHeight();
            await client.sendPrivateNote(buildStakeNote(noteScript, draft), potAddress(market.id), Math.max(0, height - 50));
          });
        } else {
          setStatus("signing");
          // privateNoteTarget on tx.execute crashes in the SDK's commit wait (TransactionFilter.ids), so relay by hand.
          const result = await tx.execute({ accountId: session.address, request: stakeRequest(buildStakeNote(noteScript, draft)) });
          txId = result.transactionId;
        }

        const position: Position = { market: market.id, side, units, salt: draft.salt, serial: draft.serial, noteId, txId, at: Date.now(), wallet: session.address, state: "pending" };
        savePosition(position);
        onPlaced(position);
        if (session.mode === "guest") {
          setStatus("relaying");
          await relayOutputNote(noteId, market.id);
        }
        setStatus("sent");
        session.refreshBalance().catch(() => undefined);
      } catch (err) {
        console.error("prediction failed", err);
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    },
    [session, script, client, bread, tx, onPlaced, relayOutputNote, runExclusive],
  );

  /** Takes an unopened stake note back into the wallet that made it. */
  const withdraw = useCallback(
    async (p: Position) => {
      if (session.mode === "guest") {
        await consume.consume({ accountId: p.wallet, notes: [p.noteId] });
      } else {
        const draft = draftOf(p);
        if (!draft || !bread.requestConsume) throw new Error("this prediction cannot be withdrawn from here");
        const note = buildStakeNote(await script(), draft);
        const txId = await bread.requestConsume(Transaction.createConsumeTransaction(MIDEN_FAUCET, p.noteId, "private", Number(BigInt(p.units) * UNIT), note.serialize()).payload as never);
        await bread.waitForTransaction?.(txId, 180_000).catch(() => undefined);
      }
      removePosition(p.noteId);
      session.refreshBalance().catch(() => undefined);
    },
    [session, consume, bread, script],
  );

  /** Moves the guest wallet's MIDEN to Bread (a private P2ID note relayed through the transport). */
  const saveToBread = useCallback(
    async (breadAddress: string) => {
      if (session.mode !== "guest" || !session.address) throw new Error("no guest wallet");
      const reserve = 50_000n; // 0.05 MIDEN kept for the fee
      const amount = (session.balanceRaw ?? 0n) - reserve;
      if (amount <= 0n) throw new Error("nothing to move");
      const result = await sendHook.send({ from: session.address, to: breadAddress, assetId: MIDEN_FAUCET, amount, noteType: "private", returnNote: true });
      if (result.note) await relayOutputNote(result.note.id().toString(), breadAddress);
      session.refreshBalance().catch(() => undefined);
      return amount;
    },
    [session, sendHook, relayOutputNote],
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
  }, []);

  return { predict, withdraw, saveToBread, status, error, reset, relayOutputNote };
}
