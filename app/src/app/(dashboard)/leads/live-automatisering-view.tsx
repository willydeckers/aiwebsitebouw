"use client";

import { useEffect, useRef, useState } from "react";
import { fetchLiveFrame } from "./store-automatisering-actions";

/**
 * Live view of a running browser automation.
 *
 * Built as its own component on purpose: the store-creation job is the first
 * user, but "watch the robot, take over when it gets stuck" is a pattern worth
 * reusing, so this knows nothing about Shopify — only a jobId.
 *
 * The stream is a JPEG the worker overwrites a few times per second. Not
 * elegant, but it needs no WebSocket server, no WebRTC, and no new
 * infrastructure, and it is entirely good enough to see progress and notice a
 * challenge screen.
 *
 * It draws into a <canvas> rather than swapping an <img src>: replacing a src
 * blanks the element for a frame, which at this rate reads as flicker. Drawing
 * the decoded image leaves the previous frame up until the next one is ready.
 */
export function LiveAutomatiseringView({
  jobId,
  actief,
  actieVereist,
}: {
  jobId: string;
  actief: boolean;
  actieVereist: string | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [heeftFrame, setHeeftFrame] = useState(false);
  // Staleness is tracked as state, updated by the same interval that fetches
  // frames. Deriving it from Date.now() at render time reads the clock during
  // render, which React can call whenever it likes — so the value would be
  // both impure and unreliable.
  const [verouderd, setVerouderd] = useState(false);
  const laatsteUpdate = useRef<number | null>(null);

  useEffect(() => {
    if (!actief) return;
    let gestopt = false;
    let bezig = false;

    async function tekenFrame() {
      if (gestopt || bezig) return;
      bezig = true;
      try {
        const dataUri = await fetchLiveFrame(jobId);
        if (!dataUri || gestopt) return;
        const img = new Image();
        img.onload = () => {
          const doek = canvas.current;
          if (!doek || gestopt) return;
          doek.width = img.naturalWidth;
          doek.height = img.naturalHeight;
          doek.getContext("2d")?.drawImage(img, 0, 0);
          setHeeftFrame(true);
          laatsteUpdate.current = Date.now();
          setVerouderd(false);
        };
        img.src = dataUri;
      } catch {
        // A missing frame is normal at the start and between navigations.
      } finally {
        bezig = false;
      }
    }

    tekenFrame();

    // A frame that stops updating almost always means the worker died, which
    // is worth saying out loud rather than showing a frozen picture.
    const staleTimer = setInterval(() => {
      if (laatsteUpdate.current !== null && Date.now() - laatsteUpdate.current > 15000) {
        setVerouderd(true);
      }
    }, 5000);
    // Slightly slower than the worker writes, so the two don't lockstep into
    // repeatedly fetching a half-written object.
    const timer = setInterval(tekenFrame, 900);
    return () => {
      gestopt = true;
      clearInterval(timer);
      clearInterval(staleTimer);
    };
  }, [jobId, actief]);

  if (!actief && !heeftFrame) return null;

  return (
    <div className="space-y-2">
      {actieVereist ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-900">Actie vereist — {actieVereist}</p>
          <p className="mt-1 text-xs text-amber-800">
            De automatisering is gepauzeerd en wacht op jou. Los dit op in het browservenster dat
            op de worker-machine openstaat (bv. de CAPTCHA aanklikken of inloggen), en klik daarna
            op Hervatten. Er wordt niets opnieuw geprobeerd tot je dat doet.
          </p>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-blue-100 bg-slate-900">
        <canvas ref={canvas} className="block w-full" />
        {!heeftFrame ? (
          <p className="p-4 text-xs text-slate-300">Wachten op beeld van de browser…</p>
        ) : null}
      </div>

      <p className="text-xs text-slate-400">
        Live beeld van de automatisering
        {verouderd ? " — beeld staat stil, mogelijk is de worker gestopt." : ""}
      </p>
    </div>
  );
}
