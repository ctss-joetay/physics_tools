import Link from "next/link";

type Tool = {
  href: string;
  name: string;
  blurb: string;
  status: "ready" | "planned";
};

const TOOLS: Tool[] = [
  {
    href: "/kinematics",
    name: "Kinematics video tracker",
    blurb:
      "Film a moving object, tap it frame by frame, and get displacement–time and velocity–time graphs with a fitted acceleration.",
    status: "ready",
  },
  {
    href: "/live",
    name: "Live motion tracker",
    blurb:
      "Point the camera at a yellow or orange ball and watch displacement–time and velocity–time graphs draw themselves. Best for carts, pendulums and rolling balls.",
    status: "ready",
  },
  {
    href: "/kinematics",
    name: "Sound timing gates",
    blurb:
      "Use the microphone as a pair of timing gates — free-fall g, speed of sound, collision timings.",
    status: "planned",
  },
  {
    href: "/kinematics",
    name: "Pendulum timer",
    blurb:
      "Accelerometer or microphone period measurement, averaged over many swings.",
    status: "planned",
  },
  {
    href: "/kinematics",
    name: "Waves & frequency",
    blurb:
      "Live FFT from the microphone — resonance tubes, tuning forks, beats.",
    status: "planned",
  },
];

export default function Home() {
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Physics Tools</h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-[var(--text-secondary)]">
          Practical instruments that run in the browser on a tablet. No app
          install, no logins, no data leaving the device — every measurement is
          taken and analysed on the iPad itself.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        {TOOLS.map((tool) => {
          const ready = tool.status === "ready";
          const card = (
            <div
              className={`h-full rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4 transition ${
                ready ? "hover:border-[var(--series-1)]" : "opacity-60"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[15px] font-medium">{tool.name}</h2>
                {!ready && (
                  <span className="shrink-0 rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]">
                    Planned
                  </span>
                )}
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-secondary)]">
                {tool.blurb}
              </p>
            </div>
          );

          return ready ? (
            <Link key={tool.name} href={tool.href} className="block">
              {card}
            </Link>
          ) : (
            <div key={tool.name}>{card}</div>
          );
        })}
      </section>
    </div>
  );
}
