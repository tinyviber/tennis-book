export const publicPath = (pathname: string) => `${process.env.NEXT_PUBLIC_BASE_PATH || ''}${pathname}`;
