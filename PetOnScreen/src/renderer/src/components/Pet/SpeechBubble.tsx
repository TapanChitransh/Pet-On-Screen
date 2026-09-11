export function SpeechBubble({ text, offsetY }: { text: string; offsetY: number }): JSX.Element {
  return (
    <div className="speech" style={{ top: offsetY }}>
      <div className="speech-inner">{text}</div>
      <div className="speech-tail" />
    </div>
  )
}
