import type { Metadata } from 'next';
import Vitrine from './vitrine';
import { en } from './content';

export const metadata: Metadata = {
  title: en.meta.title,
  description: en.meta.description,
  alternates: { canonical: '/', languages: { en: '/', fr: '/fr' } },
  openGraph: {
    title: 'Iris',
    description: en.meta.description,
    images: ['/icon.png'],
    locale: 'en',
    type: 'website'
  }
};

export default function Page() {
  return <Vitrine t={en} locale="en" />;
}
