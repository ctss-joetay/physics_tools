import VideoTracker from "@/components/VideoTracker";

export const metadata = {
  title: "Kinematics video tracker · Physics Tools",
};

export default function KinematicsPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">
          Kinematics video tracker
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-[var(--text-secondary)]">
          Film a moving object, calibrate the scale against something of known
          length, then tap the object frame by frame. You get displacement–time
          and velocity–time graphs, a least-squares acceleration, and a CSV of
          the raw data.
        </p>
      </header>
      <VideoTracker />
    </div>
  );
}
