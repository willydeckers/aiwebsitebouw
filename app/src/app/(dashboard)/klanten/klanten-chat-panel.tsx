"use client";

import { useState, useTransition } from "react";
import { startKlantChatEdit } from "./chat-actions";

type ChatMessage = { role: "user" | "systeem"; text: string };

export function KlantenChatPanel({ klantId, klantNaam }: { klantId: string; klantNaam: string }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, startTransition] = useTransition();

  function handleSend() {
    const instruction = input.trim();
    if (!instruction) return;

    setMessages((prev) => [...prev, { role: "user", text: instruction }]);
    setInput("");

    startTransition(async () => {
      const result = await startKlantChatEdit(klantId, instruction);
      setMessages((prev) => [
        ...prev,
        { role: "systeem", text: result ?? "Wijziging doorgevoerd." },
      ]);
    });
  }

  return (
    <div className="mt-4 rounded-xl border border-blue-100 p-4">
      <h3 className="text-sm font-medium text-slate-700">
        Chat-based bewerken — {klantNaam} (3.5/3.9)
      </h3>
      <p className="mt-1 text-xs text-slate-400">
        Zelfde interface voor statisch en Shopify — het systeem kiest zelf de juiste backend.
      </p>

      {messages.length > 0 ? (
        <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto rounded-xl border border-blue-100 p-2 text-xs">
          {messages.map((msg, i) => (
            <li key={i} className={msg.role === "user" ? "text-slate-800" : "text-slate-500"}>
              <span className="font-medium">{msg.role === "user" ? "Jij: " : "Systeem: "}</span>
              {msg.text}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-2 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSend();
          }}
          placeholder="bv. voeg product toe: Lentetaart, €18,50"
          className="flex-1 rounded-xl border border-blue-200 px-3 py-2 text-sm outline-none text-slate-900 focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={pending}
          className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Bezig..." : "Verstuur"}
        </button>
      </div>
    </div>
  );
}
