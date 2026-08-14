import type { Metadata } from 'next';
import { DesignPreview } from './design-preview';

export const metadata: Metadata = {
  title: 'Design System V2 Preview | Orthodox Routes',
  description: 'Isolated reference preview for the canonical Orthodox Routes Design System V2.',
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'/%3E",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function DesignPreviewPage() {
  return <DesignPreview />;
}
