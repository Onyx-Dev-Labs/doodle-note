export default function AppLoading() {
  return (
    <div aria-label="Loading" className="animate-pulse">
      <div className="h-8 w-48 rounded-lg bg-sand" />
      <div className="mt-6 h-11 rounded-lg bg-sand/70" />
      <div className="mt-5 space-y-3">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-20 rounded-xl bg-sand/50" />
        ))}
      </div>
    </div>
  );
}
