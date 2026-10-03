import type { SVGProps } from 'react';

/**
 * Hand-rolled 24px stroke icons.
 *
 * A super-app needs a handful of glyphs and nothing else; shipping an icon
 * dependency for eight paths would not pay for itself, and these inherit
 * `currentColor` so active/inactive states are pure CSS.
 */
type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.8V20h14V9.8" />
      <path d="M9.5 20v-5h5v5" />
    </Icon>
  );
}

export function TransferIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 8h13l-3-3" />
      <path d="M20 16H7l3 3" />
    </Icon>
  );
}

export function PaymentsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M3 10h18" />
      <path d="M7 15h4" />
    </Icon>
  );
}

export function MarketIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 8h16l-1.2 11.2A2 2 0 0 1 16.8 21H7.2a2 2 0 0 1-2-1.8Z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </Icon>
  );
}

export function CartIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 4h2l2.2 10.4A2 2 0 0 0 9.2 16h8.4a2 2 0 0 0 2-1.6L21 8H6" />
      <circle cx="10" cy="20" r="1.2" />
      <circle cx="18" cy="20" r="1.2" />
    </Icon>
  );
}

export function OrdersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 3h10a2 2 0 0 1 2 2v16l-3-2-2 2-2-2-2 2-3-2V5a2 2 0 0 1 2-2Z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
    </Icon>
  );
}

export function StoreIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 10v10h16V10" />
      <path d="M3 5h18l-1 5a3 3 0 0 1-5.4 1.3A3 3 0 0 1 12 13a3 3 0 0 1-2.6-1.7A3 3 0 0 1 4 10Z" />
    </Icon>
  );
}

export function LogoutIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 8 6 12l4 4" />
      <path d="M6 12h9" />
    </Icon>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.2-4.2" />
    </Icon>
  );
}

export function WalletIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="6" width="18" height="13" rx="3" />
      <path d="M3 10h18" />
      <circle cx="16.5" cy="14.5" r="1" />
    </Icon>
  );
}

/** Dispatcher console: a car on a map pin. */
export function DispatchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
      <path d="M9.5 10.5 12 9l2.5 1.5v3L12 15l-2.5-1.5Z" />
    </Icon>
  );
}

/** Taxi: a car with a roof sign. */
export function TaxiIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 17h14" />
      <path d="M4 17v-3.2a2 2 0 0 1 .3-1L6.6 9.4A2 2 0 0 1 8.3 8.5h7.4a2 2 0 0 1 1.7.9l2.3 3.4a2 2 0 0 1 .3 1V17" />
      <path d="M4 12.5h16" />
      <path d="M10 6.5h4" />
      <circle cx="7.5" cy="17.5" r="1.5" />
      <circle cx="16.5" cy="17.5" r="1.5" />
    </Icon>
  );
}

/** Services (QTime): a calendar with a bookable window. */
export function ServicesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="5" width="17" height="15" rx="3" />
      <path d="M3.5 10h17" />
      <path d="M8 3.5v3" />
      <path d="M16 3.5v3" />
      <path d="M9 14.5h3" />
      <path d="M14.5 14.5h.5" />
    </Icon>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3 5 6v5.5c0 4 3 7.6 7 9.5 4-1.9 7-5.5 7-9.5V6Z" />
      <path d="m9.2 12.2 2 2 3.6-3.9" />
    </Icon>
  );
}