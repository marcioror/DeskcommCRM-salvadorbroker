import { notFound } from "next/navigation";
import { PropertyDetailClient } from "./_client";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function PropertyDetailPage({ params }: Props) {
  const { id } = await params;
  if (!id) notFound();
  return <PropertyDetailClient propertyId={id} />;
}
