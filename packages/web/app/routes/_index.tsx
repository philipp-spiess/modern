export function meta() {
  return [{ title: "Diffs" }, { name: "description", content: "Your interface to agentic engineering" }];
}

export default function Home() {
  return (
    <main className="max-w-4xl mx-auto flex flex-col gap-10">
      <div className="border-x border-gray-950/5 dark:border-white/10 min-h-screen">
        <header className="flex items-center justify-between gap-8 line-b h-16">
          <div className="flex items-center gap-2 p-2">
            <img src="/logo.png" alt="" className="size-12" />
            <h1 className="text-center text-lg font-mono text-white/90">Diffs</h1>
          </div>
          <div className="flex h-full justify-center items-center font-mono text-white/90">
            <a
              href="#"
              className="py-2 px-6 hover:underline hover:bg-white/5 border-l border-gray-950/5 dark:border-white/10 h-full flex items-center"
            >
              Docs
            </a>
            <a
              href="#"
              className="py-2 px-6 hover:underline hover:bg-white/5 border-l border-gray-950/5 dark:border-white/10 h-full flex items-center"
            >
              GitHub
            </a>
          </div>
        </header>
        <section className="flex flex-col items-center justify-center bg-dot-pattern py-26 relative">
          <div
            className="text-sm font-mono text-white/15 absolute top-0 left-0 origin-bottom-right -translate-x-full -translate-y-full w-auto h-auto -rotate-90 bg-transparent px-1 select-none"
            aria-hidden
          >
            &lt;Hero&gt;
          </div>
          <h1 className="text-center text-[60px] md:text-[100px] tracking-tighter ml-4 font-serif text-white/95">
            A new way to build
          </h1>
          <p className="mt-8 text-center text-lg ml-4 font-mono text-white/80 text-pretty max-w-xl">
            Diffs is a new, AI-native, code editor that reimagines the way humans and machines collaborate.
          </p>
          <a
            href="#"
            className="mt-16 px-4 py-2 inline-block border text-center text-lg ml-4 font-mono text-neutral-950 hover:bg-white/85 bg-white/80 shadow-[4px_4px_0_var(--color-neutral-600)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none"
          >
            Join the waitlist
          </a>
        </section>
        <section className="py-px flex items-center outline -outline-offset-1 outline-black/10 line-y relative">
          <div
            className="text-sm font-mono text-white/15 absolute top-0 left-0 origin-bottom-right -translate-x-full -translate-y-full w-auto h-auto -rotate-90 bg-transparent px-1 select-none"
            aria-hidden
          >
            &lt;Screenshot&gt;
          </div>
          <div className="w-full aspect-3352/2082 bg-[#596357] bg-cover bg-center bg-[url(/wallpaper.jpg)] px-6">
            <img src="/screenshot.png" className="w-full aspect-3352/2082" alt="" />
          </div>
        </section>
        <div className="min-h-30" />
        <section className="outline -outline-offset-1 outline-black/10 line-y relative">
          <div
            className="text-sm font-mono text-white/15 absolute top-0 left-0 origin-bottom-right -translate-x-full -translate-y-full w-auto h-auto -rotate-90 bg-transparent px-1 select-none"
            aria-hidden
          >
            &lt;Features&gt;
          </div>

          {/* Features Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
            {/* Row 1 */}
            {/* Works with any agent */}
            <div className="bg-transparent p-6 flex flex-col min-h-[280px] border-b md:border-r border-white/10">
              <h3 className="text-lg font-mono text-white/90 mb-2">Works with any agent</h3>
              <p className="text-sm font-mono text-white/50 leading-relaxed">
                Works with Claude Code, Codex, OpenCode, and more.
              </p>
              <div className="mt-auto pt-4 flex items-center justify-center flex-1">
                <svg viewBox="0 0 140 100" className="w-full h-32">
                  {/* Nodes */}
                  <rect
                    x="5"
                    y="5"
                    width="24"
                    height="24"
                    fill="none"
                    stroke="rgba(255,255,255,0.3)"
                    strokeWidth="1"
                    className="animate-node-pulse"
                    style={{ animationDelay: "0s" }}
                  />
                  <rect
                    x="111"
                    y="5"
                    width="24"
                    height="24"
                    fill="none"
                    stroke="rgba(255,255,255,0.3)"
                    strokeWidth="1"
                    className="animate-node-pulse"
                    style={{ animationDelay: "0.5s" }}
                  />
                  <rect
                    x="5"
                    y="71"
                    width="24"
                    height="24"
                    fill="none"
                    stroke="rgba(255,255,255,0.3)"
                    strokeWidth="1"
                    className="animate-node-pulse"
                    style={{ animationDelay: "1s" }}
                  />
                  <rect
                    x="111"
                    y="71"
                    width="24"
                    height="24"
                    fill="none"
                    stroke="rgba(255,255,255,0.3)"
                    strokeWidth="1"
                    className="animate-node-pulse"
                    style={{ animationDelay: "1.5s" }}
                  />
                  {/* Center node */}
                  <rect
                    x="58"
                    y="38"
                    width="24"
                    height="24"
                    fill="none"
                    stroke="rgba(255,255,255,0.4)"
                    strokeWidth="1"
                    className="animate-node-pulse"
                    style={{ animationDelay: "0.25s" }}
                  />
                  {/* Connection lines */}
                  <line
                    x1="29"
                    y1="17"
                    x2="58"
                    y2="50"
                    stroke="rgba(255,255,255,0.2)"
                    strokeWidth="1"
                    className="animate-draw-line"
                    style={{ animationDelay: "0.2s" }}
                  />
                  <line
                    x1="82"
                    y1="50"
                    x2="111"
                    y2="17"
                    stroke="rgba(255,255,255,0.2)"
                    strokeWidth="1"
                    className="animate-draw-line"
                    style={{ animationDelay: "0.4s" }}
                  />
                  <line
                    x1="29"
                    y1="83"
                    x2="58"
                    y2="50"
                    stroke="rgba(255,255,255,0.2)"
                    strokeWidth="1"
                    className="animate-draw-line"
                    style={{ animationDelay: "0.6s" }}
                  />
                  <line
                    x1="82"
                    y1="50"
                    x2="111"
                    y2="83"
                    stroke="rgba(255,255,255,0.2)"
                    strokeWidth="1"
                    className="animate-draw-line"
                    style={{ animationDelay: "0.8s" }}
                  />
                  {/* Active dot */}
                  <circle cx="70" cy="50" r="4" fill="rgba(255,255,255,0.7)" className="animate-node-pulse" />
                </svg>
              </div>
            </div>

            {/* The best diff view */}
            <div className="bg-transparent p-6 flex flex-col min-h-[280px] border-b md:border-r border-white/10">
              <h3 className="text-lg font-mono text-white/90 mb-2">The best diff view</h3>
              <p className="text-sm font-mono text-white/50 leading-relaxed">
                The bottleneck is review, not writing. Diffs fixes that.
              </p>
              <div className="mt-auto pt-8 flex items-center justify-center">
                <div className="relative size-32">
                  {/* Radar circles */}
                  <div className="absolute inset-0 rounded-full border border-white/10" />
                  <div className="absolute inset-4 rounded-full border border-white/10" />
                  <div className="absolute inset-8 rounded-full border border-white/10" />
                  {/* Crosshairs */}
                  <div className="absolute top-1/2 left-0 right-0 h-px bg-white/10" />
                  <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/10" />
                  {/* Sweep line */}
                  <div className="absolute inset-0 animate-radar-sweep origin-center">
                    <div className="absolute top-1/2 left-1/2 w-1/2 h-px bg-linear-to-r from-white/60 to-transparent origin-left" />
                  </div>
                  {/* Blip Q1 - appears when sweep is around 315-360 degrees (top-right area) */}
                  <div
                    className="absolute top-[28%] right-[22%] size-2.5 bg-white rounded-full"
                    style={{ animation: "radar-blip 4s ease-out infinite", animationDelay: "3.5s" }}
                  />
                  {/* Blip Q3 - appears when sweep is around 135-180 degrees (bottom-left area) */}
                  <div
                    className="absolute bottom-[30%] left-[28%] size-2 bg-white rounded-full"
                    style={{ animation: "radar-blip 4s ease-out infinite", animationDelay: "1.5s" }}
                  />
                </div>
              </div>
            </div>

            {/* Local, worktree, remote */}
            <div className="bg-transparent p-6 flex flex-col min-h-[280px] border-b border-white/10 overflow-hidden sm:order-4 md:order-3">
              <h3 className="text-lg font-mono text-white/90 mb-2">Local, worktree, remote</h3>
              <p className="text-sm font-mono text-white/50 leading-relaxed">
                DIffs runs your agents wherever you need them.
              </p>
              <div className="mt-auto pt-2 h-36 relative overflow-hidden">
                {/* Matrix code rain - wider spread */}
                <div className="absolute inset-0 flex gap-2 justify-between opacity-70 px-2">
                  {Array.from({ length: 12 }).map((_, col) => (
                    <div key={col} className="flex flex-col text-[9px] font-mono text-white/40 leading-tight">
                      {Array.from({ length: 14 }).map((_, row) => (
                        <span
                          key={row}
                          className="animate-code-rain"
                          style={{
                            animationDelay: `${col * 0.25 + row * 0.12}s`,
                            animationDuration: `${2 + Math.random() * 2}s`,
                          }}
                        >
                          {String.fromCharCode(33 + Math.floor(Math.random() * 94))}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Row 2 */}
            {/* Tab, Tab, Taaaab - Steerable Autocomplete */}
            <div className="bg-transparent p-6 flex flex-col min-h-[320px] border-b border-white/10 sm:col-span-2 md:col-span-2 sm:order-3 md:order-4">
              <h3 className="text-lg font-mono text-white/90 mb-2">Tab, Tab, Taaaab</h3>
              <p className="text-sm font-mono text-white/50 leading-relaxed max-w-lg">
                Steerable autocomplete that follows your intent. Guide the AI mid-completion to get exactly what you
                need.
              </p>
              <div className="mt-auto pt-6 flex-1 relative overflow-hidden font-mono text-[13px]">
                {/* Code editor simulation */}
                <div className="space-y-0.5">
                  <div className="flex">
                    <span className="text-[#dedcd550] w-6 text-right mr-3 select-none">1</span>
                    <span className="text-[#cb7676]">async</span>
                    <span className="text-[#cb7676] ml-1">function</span>
                    <span className="text-[#80a665] ml-1">fetchUserData</span>
                    <span className="text-[#666666]">(</span>
                    <span className="text-[#bd976a]">userId</span>
                    <span className="text-[#666666]">:</span>
                    <span className="text-[#5d99a9] ml-1">string</span>
                    <span className="text-[#666666]">)</span>
                    <span className="text-[#666666] ml-1">{"{"}</span>
                  </div>
                  <div className="flex">
                    <span className="text-[#dedcd550] w-6 text-right mr-3 select-none">2</span>
                    <span className="text-[#4d9375] ml-4">try</span>
                    <span className="text-[#666666] ml-1">{"{"}</span>
                  </div>
                  <div className="flex">
                    <span className="text-[#dedcd550] w-6 text-right mr-3 select-none">3</span>
                    <span className="text-[#cb7676] ml-8">const</span>
                    <span className="text-[#bd976a] ml-1">response</span>
                    <span className="text-[#cb7676] ml-1">=</span>
                    <span className="text-[#4d9375] ml-1">await</span>
                    <span className="text-[#80a665] ml-1">fetch</span>
                    <span className="text-[#666666]">(</span>
                  </div>
                  <div className="flex relative">
                    <span className="text-[#dedcd550] w-6 text-right mr-3 select-none">4</span>
                    <span className="ml-12 text-[#c98a7d77]">`</span>
                    <span className="text-[#c98a7d]">/api/users/</span>
                    <span className="text-[#4d9375]">{"${"}</span>
                    <span className="text-[#bd976a]">userId</span>
                    <span className="text-[#4d9375]">{"}"}</span>
                    <span className="text-[#c98a7d77]">`</span>
                    {/* Ghost text */}
                    <span className="text-white/25">,</span>
                  </div>
                  <div className="flex items-start">
                    <span className="text-[#dedcd550] w-6 text-right mr-3 select-none">5</span>
                    <span className="text-white/25 ml-12">{"{ headers: { Authorization: `Bearer ${token}` } }"}</span>
                  </div>
                  <div className="flex">
                    <span className="text-[#dedcd550] w-6 text-right mr-3 select-none">6</span>
                    <span className="text-white/25 ml-8">);</span>
                  </div>
                  <div className="flex">
                    <span className="text-[#dedcd550] w-6 text-right mr-3 select-none">7</span>
                    <span className="text-white/25 ml-8">if (!response.ok) throw new Error("Failed");</span>
                  </div>
                  <div className="flex">
                    <span className="text-[#dedcd550] w-6 text-right mr-3 select-none">8</span>
                    <span className="text-white/25 ml-8">return response.json();</span>
                  </div>
                </div>
                {/* Steering input overlay */}
                <div className="absolute top-[4.5em] left-[16em] bg-neutral-900 border border-white/20 rounded shadow-lg px-2 py-1 flex items-center gap-2">
                  <span className="text-[10px] text-white/40 uppercase tracking-wide">steer:</span>
                  <span className="text-white/70 text-xs">add auth headers</span>
                  <span className="inline-block w-[2px] h-3 bg-white/70 animate-[blink_1s_step-end_infinite] -ml-2" />
                </div>
                {/* Tab hints */}
                <div className="absolute bottom-0 right-0 flex items-center gap-2 text-xs text-white/30">
                  <span className="px-1.5 py-0.5 border border-white/20 rounded text-[10px]">Tab</span>
                  <span>accept</span>
                  <span className="text-white/20">·</span>
                  <span className="px-1.5 py-0.5 border border-white/20 rounded text-[10px]">Hold Tab</span>
                  <span>steer</span>
                </div>
              </div>
            </div>

            {/* Integrated agent */}
            <div className="bg-transparent p-6 flex flex-col min-h-[320px] border-b md:border-b-0 border-white/10 sm:order-5 md:order-5">
              <h3 className="text-lg font-mono text-white/90 mb-2">Integrated agent, no chat sidebar</h3>
              <p className="text-sm font-mono text-white/50 leading-relaxed">
                The agent lives in your editor, not a chat window.
              </p>
              <div className="mt-auto pt-4 w-full flex justify-center">
                {/* GitHub contribution-style grid */}
                <div className="grid grid-cols-[repeat(20,1fr)] gap-[2px] w-full max-w-[330px]">
                  {Array.from({ length: 20 }).map((_, col) => (
                    <div key={col} className="flex flex-col gap-[2px]">
                      {Array.from({ length: 9 }).map((_, row) => {
                        // More chaotic seed for realistic noise
                        const noise1 = Math.sin(col * 12.9898 + row * 78.233) * 43758.5453;
                        const noise2 = Math.cos(col * 39.346 + row * 11.135) * 28462.2345;
                        const seed = Math.abs((noise1 + noise2) % 100);
                        // Weighted distribution: more empty/low, fewer high intensity
                        const intensity = seed < 25 ? 0 : seed < 45 ? 1 : seed < 65 ? 2 : seed < 82 ? 3 : 4;
                        const opacities = [0.05, 0.15, 0.28, 0.42, 0.58];
                        const baseOpacity = opacities[intensity];
                        const delay = ((col * 0.1 + row * 0.08) % 3) + Math.random() * 0.5;
                        return (
                          <div
                            key={row}
                            className="aspect-square w-full rounded-[2px]"
                            style={{
                              backgroundColor: `rgba(255, 255, 255, ${baseOpacity})`,
                              animation: `contribution-blink ${2.5 + Math.random() * 2}s ease-in-out infinite`,
                              animationDelay: `${delay}s`,
                              // @ts-expect-error CSS custom properties
                              "--base-opacity": baseOpacity * 0.5,
                              "--peak-opacity": Math.min(baseOpacity + 0.2, 0.7),
                            }}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="min-h-30" />
        <footer className="flex items-center justify-center gap-8 p-2 min-h-30 bg-dot-pattern relative line-t">
          <div
            className="text-sm font-mono text-white/15 absolute top-0 left-0 origin-bottom-right -translate-x-full -translate-y-full w-auto h-auto -rotate-90 bg-transparent px-1 select-none"
            aria-hidden
          >
            &lt;Footer&gt;
          </div>
          <p className="text-center text-sm font-mono text-white/90 ">© 2025 Diffs. All rights reserved.</p>
        </footer>
      </div>
    </main>
  );
}
