export default function ServiceArt({
  kind,
}: {
  kind: "taxi" | "delivery" | "cargo" | "equipment";
}) {
  const truck = kind === "cargo",
    crane = kind === "equipment",
    delivery = kind === "delivery";
  return (
    <svg
      viewBox="0 0 240 132"
      fill="none"
      aria-hidden="true"
      className="service-art"
    >
      <defs>
        <linearGradient
          id={kind + "body"}
          x1="90"
          y1="44"
          x2="120"
          y2="105"
          gradientUnits="userSpaceOnUse"
        >
          <stop
            stopColor={
              truck || crane ? "#FFDD75" : delivery ? "#82BAA3" : "#FFFDF2"
            }
          />
          <stop
            offset="1"
            stopColor={
              truck || crane ? "#EAAA2C" : delivery ? "#1C775C" : "#CFD7CF"
            }
          />
        </linearGradient>
        <linearGradient id={kind + "glass"} x1="100" y1="38" x2="130" y2="70">
          <stop stopColor="#7E9D9D" />
          <stop offset="1" stopColor="#293F3D" />
        </linearGradient>
      </defs>
      <ellipse cx="129" cy="112" rx="90" ry="9" fill="#173B32" opacity=".1" />
      {truck || crane ? (
        <>
          <path d="M35 52h113v48H35z" fill={"url(#" + kind + "body)"} />
          <path d="M148 60h36l23 25v18h-59z" fill="#F7F8F0" />
          <path d="M157 66h22l15 18h-37z" fill={"url(#" + kind + "glass)"} />
          <path d="M29 99h182v8H29z" fill="#51635A" />
          {crane ? (
            <>
              <path d="m70 53 60-41 11 14-59 37z" fill="#FFD46B" />
              <path d="m129 13 10-6 8 11-9 9z" fill="#2D4940" />
              <path
                d="M144 20v29m0 0v10a5 5 0 0 1-10 0"
                stroke="#2D4940"
                strokeWidth="4"
              />
              <path d="M43 48h54v11H43z" fill="#367F66" />
            </>
          ) : (
            <path d="M34 43h112v14H34z" fill="#43856D" />
          )}
        </>
      ) : (
        <>
          <path
            d="M43 78c8-7 19-12 31-14l22-25c4-4 8-6 14-6h43c6 0 10 3 15 7l25 25 20 10c6 3 9 8 9 15v10H36V89c0-5 3-9 7-11Z"
            fill={"url(#" + kind + "body)"}
          />
          <path
            d="m83 65 22-25h43c5 0 9 2 13 6l17 19H83Z"
            fill={"url(#" + kind + "glass)"}
          />
          <path d="M131 40v25" stroke="#D4DED6" strokeWidth="5" />
          <path
            d="m47 84 25-2m117-4 20 10"
            stroke="#FFF9D8"
            strokeWidth="7"
            strokeLinecap="round"
          />
          <path d="M37 100h183v5H37z" fill="#4D6259" />
          <path
            d="M91 71v24m83-24v25m-69-22h10"
            stroke="#7D998A"
            strokeWidth="2"
          />
          {!delivery && (
            <rect x="118" y="26" width="25" height="8" rx="3" fill="#F7CD42" />
          )}
        </>
      )}
      {[truck || crane ? 64 : 78, truck || crane ? 178 : 177].map((x) => (
        <g key={x}>
          <circle cx={x} cy="103" r="17" fill="#293D36" />
          <circle cx={x} cy="103" r="9" fill="#9DAFA4" />
          <circle cx={x} cy="103" r="4" fill="#D8E0D8" />
        </g>
      ))}
      {delivery && (
        <g transform="translate(25 61)">
          <path d="m0 9 23-9 24 10-23 10z" fill="#E9BE83" />
          <path d="M0 9v31l24 11V20z" fill="#C88649" />
          <path d="M24 20v31l23-12V10z" fill="#AA6F3F" />
          <path d="m11 5 24 10v13" stroke="#F9DEB6" strokeWidth="6" />
        </g>
      )}
    </svg>
  );
}
