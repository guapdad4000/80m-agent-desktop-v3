import React from "react";

interface AtmMascotProps {
  state?:
    | "default"
    | "processing"
    | "typing"
    | "sleep"
    | "error"
    | "searching"
    | "jackpot"
    | "lobster"
    | "urgent"
    | "job-done";
  isIntro?: boolean;
  className?: string;
}

const AtmMascot: React.FC<AtmMascotProps> = ({
  state = "default",
  isIntro = false,
  className = "",
}) => {
  return (
    <div
      className={`w-full h-full flex items-center justify-center atm-container ${isIntro ? "mascot-intro-wrapper" : `atm-container anim-${state}`} ${className}`}
    >
      <style>{`
        .atm-character { animation: master-hover 4.5s ease-in-out infinite; animation-delay: ${isIntro ? "2.8s" : "0s"}; transform-origin: center; }
        .atm-shadow { transform-origin: 400px 920px; animation: shadow-pulse 4.5s ease-in-out infinite; opacity: ${isIntro ? "0" : "1"}; transition: opacity 1s ease-out 2.4s; }
        .wing-left-container { transform-origin: 220px 450px; animation: flutter-left 0.12s ease-in-out infinite alternate; }
        .wing-right-container { transform-origin: 580px 450px; animation: flutter-right 0.12s ease-in-out infinite alternate; }
        .eye-anim { transform-origin: center; transform-box: fill-box; animation: blink 5s infinite; }
        .anim-sleep .sleep-zzz-1 { animation: zzz-float 3s linear infinite; }
        .anim-sleep .sleep-zzz-2 { animation: zzz-float 3s linear infinite 1s; }
        .anim-searching .scan-line { animation: scan-line-anim 1.5s linear infinite alternate; }
        .anim-typing .atm-character { animation: typing-bounce 0.15s infinite; }
        .anim-error .atm-character { animation: shake-anim 0.2s infinite; }
        .anim-jump .atm-character { animation: jump-anim 1s cubic-bezier(0.28, 0.84, 0.42, 1); }
        .anim-jackpot .dollar-bill { animation: bill-rain 0.3s linear infinite; }
        .anim-lobster .pincer-move { animation: claw-snap 0.2s infinite; }
        .anim-urgent .atm-character { animation: shake-anim 0.1s infinite; }
        .anim-processing .eye-anim { animation: look-around 2s ease-in-out infinite; }
        .anim-processing .top-light-glow, .anim-processing .top-light-glow rect { fill: #4ade80; filter: drop-shadow(0 0 10px #4ade80); animation: flash-gold 0.4s infinite alternate; }
      `}</style>

      <div className={isIntro ? "mascot-intro-wrapper" : "w-full"}>
        <svg
          viewBox="-50 -50 900 1150"
          className="w-full h-auto drop-shadow-2xl overflow-visible"
        >
          <defs>
            <filter id="drop-shadow">
              <feDropShadow
                dx="0"
                dy="25"
                stdDeviation="20"
                floodColor="#000000"
                floodOpacity="0.4"
              />
            </filter>
            <linearGradient id="beigeBody" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#d6d2c1" />
              <stop offset="15%" stopColor="#eae7de" />
              <stop offset="45%" stopColor="#cbc9ba" />
              <stop offset="85%" stopColor="#b5b3a3" />
              <stop offset="100%" stopColor="#8d8b7d" />
            </linearGradient>
            <radialGradient id="screenGrad" cx="50%" cy="40%" r="60%">
              <stop offset="0%" stopColor="#fff9c4" />
              <stop offset="30%" stopColor="#ffeb3b" />
              <stop offset="100%" stopColor="#f57c00" />
            </radialGradient>
            <radialGradient id="blushGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ff6b6b" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#ffc9c9" stopOpacity="0" />
            </radialGradient>
            <g id="feather-wing">
              <path
                d="M 0,0 C 70,-70 150,-90 220,-110 C 240,-80 210,-40 180,-10 C 220,-5 220,30 180,40 C 210,60 190,90 150,80 C 160,110 130,140 90,120 C 110,150 70,170 30,130 C 20,110 10,60 0,0 Z"
                fill="#f8fafc"
                stroke="#cbd5e1"
                strokeWidth="4"
              />
            </g>
            <clipPath id="screen-clip">
              <rect x="235" y="255" width="330" height="200" rx="12" />
            </clipPath>
          </defs>

          <g className="atm-shadow">
            <ellipse
              cx="400"
              cy="920"
              rx="320"
              ry="40"
              fill="rgba(0,0,0,0.18)"
              filter="blur(12px)"
            />
          </g>

          <g className="atm-character">
            {/* Lobster Claws */}
            <g
              className="lobster-claws-container"
              opacity={state === "lobster" ? 1 : 0}
            >
              <g transform="translate(130, 480)">
                <path
                  d="M 0 0 Q -50 -20 -80 20"
                  fill="none"
                  stroke="#dc2626"
                  strokeWidth="24"
                  strokeLinecap="round"
                />
                <path
                  d="M -80 20 C -120 -20 -160 30 -100 80 C -80 90 -60 60 -80 20"
                  fill="#ef4444"
                  stroke="#991b1b"
                  strokeWidth="4"
                />
                <g transform="translate(-100, 80)" className="pincer-move">
                  <path
                    d="M 0 0 C -20 30 -60 20 -40 -10 Z"
                    fill="#ef4444"
                    stroke="#991b1b"
                    strokeWidth="4"
                  />
                </g>
              </g>
              <g transform="translate(670, 480) scale(-1, 1)">
                <path
                  d="M 0 0 Q -50 -20 -80 20"
                  fill="none"
                  stroke="#dc2626"
                  strokeWidth="24"
                  strokeLinecap="round"
                />
                <path
                  d="M -80 20 C -120 -20 -160 30 -100 80 C -80 90 -60 60 -80 20"
                  fill="#ef4444"
                  stroke="#991b1b"
                  strokeWidth="4"
                />
                <g transform="translate(-100, 80)" className="pincer-move">
                  <path
                    d="M 0 0 C -20 30 -60 20 -40 -10 Z"
                    fill="#ef4444"
                    stroke="#991b1b"
                    strokeWidth="4"
                  />
                </g>
              </g>
            </g>

            <g className="wing-left-container">
              <use
                href="#feather-wing"
                transform="translate(190, 420) scale(-1, 1) rotate(15)"
              />
            </g>
            <g className="wing-right-container">
              <use
                href="#feather-wing"
                transform="translate(610, 420) scale(1, 1) rotate(-15)"
              />
            </g>

            <g filter="url(#drop-shadow)">
              <rect
                x="180"
                y="150"
                width="440"
                height="730"
                rx="50"
                fill="url(#beigeBody)"
                stroke="#111"
                strokeWidth="6"
              />
              <path
                d="M 180 550 Q 180 880 230 880 L 570 880 Q 620 880 620 550 Z"
                fill="rgba(0,0,0,0.1)"
              />
            </g>

            <rect
              x="210"
              y="230"
              width="380"
              height="250"
              rx="25"
              fill="#111"
            />
            <rect
              x="235"
              y="255"
              width="330"
              height="200"
              rx="12"
              fill="url(#screenGrad)"
            />

            {/* Overlays */}
            <rect
              x="235"
              y="255"
              width="330"
              height="200"
              rx="12"
              fill="#ef4444"
              opacity={state === "error" ? 0.7 : 0}
              style={{ mixBlendMode: "multiply" }}
            />
            <rect
              x="235"
              y="255"
              width="330"
              height="200"
              rx="12"
              fill="#0f172a"
              opacity={state === "sleep" ? 0.7 : 0}
              style={{ mixBlendMode: "multiply" }}
            />
            <rect
              x="235"
              y="255"
              width="330"
              height="200"
              rx="12"
              fill="#10b981"
              opacity={state === "searching" ? 0.5 : 0}
              style={{ mixBlendMode: "overlay" }}
            />

            <g clipPath="url(#screen-clip)">
              <line
                x1="235"
                y1="255"
                x2="565"
                y2="255"
                stroke="#22c55e"
                strokeWidth="16"
                className="scan-line"
                style={{ opacity: state === "searching" ? 1 : 0 }}
              />
            </g>

            <g transform="translate(400, 355)">
              <ellipse
                cx="-100"
                cy="25"
                rx="45"
                ry="32"
                fill="url(#blushGrad)"
              />
              <ellipse
                cx="100"
                cy="25"
                rx="45"
                ry="32"
                fill="url(#blushGrad)"
              />

              <g
                opacity={
                  state === "error" ||
                  state === "sleep" ||
                  state === "job-done" ||
                  state === "urgent" ||
                  state === "lobster" ||
                  state === "processing" ||
                  state === "typing" ||
                  state === "jackpot"
                    ? 0
                    : 1
                }
              >
                <g transform="translate(-70, -5)">
                  <g className="eye-anim">
                    <ellipse rx="16" ry="24" fill="#241400" />
                    <circle cx="-5" cy="-8" r="6" fill="white" opacity="0.9" />
                  </g>
                </g>
                <g transform="translate(70, -5)">
                  <g className="eye-anim">
                    <ellipse rx="16" ry="24" fill="#241400" />
                    <circle cx="-5" cy="-8" r="6" fill="white" opacity="0.9" />
                  </g>
                </g>
                <path
                  d="M -28 20 C -15 50, 15 50, 28 20"
                  fill="none"
                  stroke="#241400"
                  strokeWidth="12"
                  strokeLinecap="round"
                />
              </g>

              {state === "job-done" && (
                <g>
                  <path
                    d="M -80 0 Q -50 -25 -20 0"
                    stroke="#241400"
                    strokeWidth="12"
                    fill="none"
                    strokeLinecap="round"
                  />
                  <path
                    d="M 20 0 Q 50 -25 80 0"
                    stroke="#241400"
                    strokeWidth="12"
                    fill="none"
                    strokeLinecap="round"
                  />
                  <path d="M -25 35 Q 0 80 25 35 Z" fill="#241400" />
                </g>
              )}
              {state === "sleep" && (
                <g>
                  <line
                    x1="-85"
                    y1="5"
                    x2="-55"
                    y2="5"
                    stroke="#241400"
                    strokeWidth="8"
                    strokeLinecap="round"
                  />
                  <line
                    x1="55"
                    y1="5"
                    x2="85"
                    y2="5"
                    stroke="#241400"
                    strokeWidth="8"
                    strokeLinecap="round"
                  />
                  <circle
                    cx="0"
                    cy="25"
                    r="8"
                    fill="none"
                    stroke="#241400"
                    strokeWidth="6"
                  />
                </g>
              )}
              {state === "urgent" && (
                <g>
                  <circle cx="-45" cy="10" r="8" fill="#241400" />
                  <circle cx="45" cy="10" r="8" fill="#241400" />
                  <path
                    d="M -75 -40 Q -65 -65 -55 -40 A 10 10 0 0 1 -75 -40 Z"
                    fill="#22d3ee"
                  />
                </g>
              )}
              {state === "processing" && (
                <g>
                  <g transform="translate(-70, -5)">
                    <ellipse
                      rx="16"
                      ry="24"
                      fill="#241400"
                      className="eye-anim"
                    />
                    <circle cx="-5" cy="-8" r="6" fill="white" opacity="0.9" />
                  </g>
                  <g transform="translate(70, -5)">
                    <ellipse
                      rx="16"
                      ry="24"
                      fill="#241400"
                      className="eye-anim"
                    />
                    <circle cx="-5" cy="-8" r="6" fill="white" opacity="0.9" />
                  </g>
                  <path
                    d="M -28 20 C -15 50, 15 50, 28 20"
                    fill="none"
                    stroke="#241400"
                    strokeWidth="12"
                    strokeLinecap="round"
                  />
                </g>
              )}
              {state === "typing" && (
                <g>
                  <ellipse cx="-40" cy="5" rx="14" ry="20" fill="#241400" />
                  <circle cx="-35" cy="12" r="4" fill="#ffffff" />
                  <ellipse cx="40" cy="5" rx="14" ry="20" fill="#241400" />
                  <circle cx="45" cy="12" r="4" fill="#ffffff" />
                  <line
                    x1="-15"
                    y1="30"
                    x2="15"
                    y2="30"
                    stroke="#241400"
                    strokeWidth="7"
                    strokeLinecap="round"
                  />
                </g>
              )}
              {state === "jackpot" && (
                <g>
                  <path
                    d="M -90 0 Q -70 -20 -50 0 Q -70 -10 -90 0"
                    fill="none"
                    stroke="#241400"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M 50 0 Q 70 -20 90 0 Q 70 -10 50 0"
                    fill="none"
                    stroke="#241400"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path d="M -20 15 Q 0 50 20 15 Z" fill="#241400" />
                  <path d="M -10 25 Q 0 40 10 25 Z" fill="#ef4444" />
                </g>
              )}
              {state === "error" && (
                <g>
                  <path
                    d="M -90 -10 L -50 10 M -90 10 L -50 -10"
                    fill="none"
                    stroke="#241400"
                    strokeWidth="9"
                    strokeLinecap="round"
                  />
                  <path
                    d="M 50 10 L 90 -10 M 50 -10 L 90 10"
                    fill="none"
                    stroke="#241400"
                    strokeWidth="9"
                    strokeLinecap="round"
                  />
                  <path
                    d="M -20 30 L -10 20 L 0 30 L 10 20 L 20 30"
                    fill="none"
                    stroke="#241400"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              )}
              {state === "searching" && (
                <g>
                  <circle
                    cx="-40"
                    cy="-5"
                    r="18"
                    fill="none"
                    stroke="#241400"
                    strokeWidth="6"
                  />
                  <circle
                    cx="40"
                    cy="-5"
                    r="18"
                    fill="none"
                    stroke="#241400"
                    strokeWidth="6"
                  />
                  <line
                    x1="-22"
                    y1="-5"
                    x2="22"
                    y2="-5"
                    stroke="#241400"
                    strokeWidth="6"
                  />
                  <circle cx="-48" cy="-5" r="5" fill="#241400" />
                  <circle cx="32" cy="-5" r="5" fill="#241400" />
                  <path
                    d="M -15 25 Q 0 35 15 25"
                    fill="none"
                    stroke="#241400"
                    strokeWidth="6"
                    strokeLinecap="round"
                  />
                </g>
              )}
              {state === "lobster" && (
                <g>
                  <path
                    d="M -30 -50 Q -50 -90 -80 -70"
                    fill="none"
                    stroke="#ef4444"
                    strokeWidth="8"
                    strokeLinecap="round"
                  />
                  <path
                    d="M 30 -50 Q 50 -90 80 -70"
                    fill="none"
                    stroke="#ef4444"
                    strokeWidth="8"
                    strokeLinecap="round"
                  />
                  <circle cx="-80" cy="-70" r="6" fill="#ef4444" />
                  <circle cx="80" cy="-70" r="6" fill="#ef4444" />
                  <path
                    d="M -60 -5 L -20 10"
                    fill="none"
                    stroke="#241400"
                    strokeWidth="10"
                    strokeLinecap="round"
                  />
                  <path
                    d="M 60 -5 L 20 10"
                    fill="none"
                    stroke="#241400"
                    strokeWidth="10"
                    strokeLinecap="round"
                  />
                  <circle cx="-40" cy="5" r="10" fill="#241400" />
                  <circle cx="40" cy="5" r="10" fill="#241400" />
                  <path
                    d="M -10 30 Q 0 20 10 30"
                    fill="none"
                    stroke="#241400"
                    strokeWidth="6"
                    strokeLinecap="round"
                  />
                </g>
              )}
            </g>

            <g className="sleep-zzzs" opacity={state === "sleep" ? 1 : 0}>
              <text
                x="500"
                y="200"
                fontSize="50"
                fontFamily="Arial Rounded MT Bold"
                fill="#cbd5e1"
                className="sleep-zzz-1"
              >
                Z
              </text>
              <text
                x="540"
                y="150"
                fontSize="40"
                fontFamily="Arial Rounded MT Bold"
                fill="#94a3b8"
                className="sleep-zzz-2"
              >
                z
              </text>
            </g>

            <g transform="translate(400, 520)">
              {[0, 1, 2].map((row) =>
                [0, 1, 2, 3].map((col) => (
                  <rect
                    key={`${row}-${col}`}
                    x={col * 42}
                    y={row * 30}
                    width="36"
                    height="24"
                    rx="4"
                    fill={
                      col === 3
                        ? row === 0
                          ? "#ef4444"
                          : row === 1
                            ? "#eab308"
                            : "#22c55e"
                        : "#111"
                    }
                    stroke="#111"
                    strokeWidth="2"
                  />
                )),
              )}
            </g>

            <g className="dollar-bill-group">
              <path
                className="dollar-bill"
                d="M 280 750 L 520 750 L 525 830 Q 400 850 275 830 Z"
                fill="#dcfce7"
                stroke="#22c55e"
                strokeWidth="3"
                opacity={state === "jackpot" ? 1 : 0.4}
              />
            </g>

            <g transform="translate(600, 210)">
              <text
                x="0"
                y="0"
                fontWeight="900"
                fontSize="52"
                fill="white"
                textAnchor="end"
                style={{ textShadow: "2px 2px 0px #111" }}
              >
                80m
              </text>
            </g>

            {/* Top Light — glowing indicator */}
            <g transform="translate(400, 195)">
              <rect
                x="-45"
                y="0"
                width="90"
                height="12"
                rx="6"
                fill="#1e293b"
              />
              <rect
                x="-42"
                y="2"
                width="84"
                height="8"
                rx="4"
                fill="#22c55e"
                className="top-light-glow"
              />
            </g>
          </g>
        </svg>
        {isIntro && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="impact-ring" />
            <div className="impact-ring-2" />
            <div className="impact-ring-3" />
          </div>
        )}
      </div>
    </div>
  );
};

export default AtmMascot;
