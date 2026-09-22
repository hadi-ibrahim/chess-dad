import GameReview from "./GameReview";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GameReview id={id} />;
}
