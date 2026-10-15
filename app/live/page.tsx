import LiveTracker from "@/components/LiveTracker";

export const metadata = {
  title: "Live motion tracker · Physics Tools",
};

export default function LivePage() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">
          Live motion tracker
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-[var(--text-secondary)]">
          Point the camera at a bright yellow or orange ball and the tracker
          follows it by itself, drawing displacement–time and velocity–time
          graphs as it moves. The camera runs at about 30 frames a second, which
          suits carts, pendulums and rolling or bouncing balls; for anything
          as fast as free fall, use the video tracker with slow motion.
        </p>
      </header>
      <LiveTracker />
    </div>
  );
}
