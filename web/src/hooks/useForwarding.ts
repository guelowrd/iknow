import { useCallback, useEffect, useRef, useState } from "react";
import { useConsume, useMiden, useMidenClient, useSend } from "@miden-sdk/react";
import { NoteScript } from "@miden-sdk/miden-sdk";
import { MIDEN_FAUCET, POLL_MS, UNIT } from "@/config";
import { fmt, parseId } from "@/lib/iknow";
import type { Session } from "./useSession";

const RESERVE = 50_000n; // 0.05 MIDEN kept for fees

/** Notes sent to Bread whose relay through the transport has not succeeded yet. */
const OUT_KEY = "iknow:outgoing";
type Outgoing = { noteId: string; to: string };
const readOut = (): Outgoing[] => {
  try {
    return JSON.parse(localStorage.getItem(OUT_KEY) ?? "[]");
  } catch {
    return [];
  }
};
const writeOut = (xs: Outgoing[]) => {
  try {
    localStorage.setItem(OUT_KEY, JSON.stringify(xs));
  } catch {
    /* private mode */
  }
};
const delivered = (err: unknown) => /unique constraint|malformed response/i.test(String(err)); // the transport already has it

/** The guest wallet lives in this browser, so the app runs it: it opens what the wallet receives
 * (payouts, refunds) and, whenever Bread is the connected wallet here, forwards the balance to
 * Bread. The chain always pays the account that staked, so this is how a guest payout reaches
 * Bread. Nothing leaves the guest while it is the active wallet, except through SAVE. */
export function useForwarding(session: Session, relay: (noteId: string, to: string) => Promise<void>, idle: boolean) {
  const { isReady, runExclusive } = useMiden();
  const client = useMidenClient();
  const consume = useConsume();
  const sendHook = useSend();
  // hook objects change identity on renders: keep them out of the callbacks' dependencies
  const api = useRef({ consume, sendHook, relay, refresh: session.refreshBalance });
  api.current = { consume, sendHook, relay, refresh: session.refreshBalance };
  const running = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const guestId = session.guestId;
  const bread = session.mode === "bread" ? session.address : null;

  /** Opens the guest's P2ID notes (payouts, refunds, faucet); a pending stake note stays put. */
  const collect = useCallback(async (guest: string) => {
    await runExclusive(async () => {
      await client.fetchPrivateNotes();
      await client.syncState();
    });
    const p2id = NoteScript.p2id().root().toHex();
    const notes = await runExclusive(() => client.getConsumableNotes(parseId(guest)));
    const ids = notes
      .filter((n) => n.inputNoteRecord().details().recipient().script().root().toHex() === p2id)
      .map((n) => n.inputNoteRecord().id()?.toString())
      .filter((x): x is string => !!x);
    if (ids.length > 0) await api.current.consume.consume({ accountId: guest, notes: ids });
    return ids.length;
  }, [runExclusive, client]);

  /** Moves the guest balance, minus the fee reserve, to Bread as a private note through the transport. */
  const forward = useCallback(async (guest: string, to: string) => {
    const balance = await runExclusive(async () => (await client.getAccount(parseId(guest)))?.vault().getBalance(parseId(MIDEN_FAUCET)) ?? 0n);
    const amount = balance - RESERVE;
    if (amount < UNIT) return 0n;
    const result = await api.current.sendHook.send({ from: guest, to, assetId: MIDEN_FAUCET, amount, noteType: "private", returnNote: true });
    if (result.note) {
      const noteId = result.note.id().toString();
      writeOut([...readOut(), { noteId, to }]); // retried by the next tick if the relay fails now
      await api.current.relay(noteId, to);
      writeOut(readOut().filter((o) => o.noteId !== noteId));
    }
    return amount;
  }, [runExclusive, client]);

  /** SAVE: moves what the guest holds now. */
  const forwardNow = useCallback(async (to: string) => {
    if (!guestId) throw new Error("no guest wallet");
    await collect(guestId).catch(() => 0);
    const moved = await forward(guestId, to);
    if (moved === 0n) throw new Error("nothing to move");
    api.current.refresh().catch(() => undefined);
    return moved;
  }, [guestId, collect, forward]);

  const tick = useCallback(async () => {
    if (!isReady || !guestId || running.current || !idle) return;
    running.current = true;
    try {
      for (const o of readOut()) {
        try {
          await api.current.relay(o.noteId, o.to);
          writeOut(readOut().filter((x) => x.noteId !== o.noteId));
        } catch (err) {
          if (delivered(err)) writeOut(readOut().filter((x) => x.noteId !== o.noteId));
        }
      }
      const opened = await collect(guestId);
      const moved = bread ? await forward(guestId, bread) : 0n;
      if (opened > 0) setNotice(`${opened} payout note${opened > 1 ? "s" : ""} received`);
      if (moved > 0n) setNotice(`${fmt(Number(moved / UNIT))} MIDEN forwarded to Bread`);
      if (opened > 0 || moved > 0n) api.current.refresh().catch(() => undefined);
      console.debug(`guest upkeep: ${guestId.slice(0, 10)} opened ${opened}, forwarded ${moved}${bread ? " to Bread" : ""}`);
    } catch (err) {
      console.warn("guest wallet upkeep failed", err);
    } finally {
      running.current = false;
    }
  }, [isReady, guestId, idle, bread, collect, forward]);

  useEffect(() => {
    tick();
    const t = setInterval(tick, POLL_MS * 3);
    return () => clearInterval(t);
  }, [tick]);

  return { notice, forwardNow };
}
