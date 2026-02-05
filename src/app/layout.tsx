import "./globals.css";
import type { Metadata } from "next";
import { Playfair_Display, Source_Sans_3 } from "next/font/google";

const display = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-display"
});

const body = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-body"
});

export const metadata: Metadata = {
  title: "Congreso Votos",
  description: "Resumen visual del historial de voto en el Congreso de los Diputados"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
