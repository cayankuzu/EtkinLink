import NetInfo from '@react-native-community/netinfo';
import { Image as ExpoImage, type ImageProps } from 'expo-image';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

const retryDelaysMs = [450, 1_200] as const;

export function stableImageCacheKey(uri: string): string {
  try {
    const parsed = new URL(uri);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return uri.split(/[?#]/u)[0] ?? uri;
  }
}

type AppImageProps = Omit<
  ImageProps,
  'cachePolicy' | 'contentFit' | 'placeholder' | 'source'
> & {
  uri: string | null | undefined;
  fallback?: ReactNode;
  fit?: ImageProps['contentFit'];
  highPriority?: boolean;
};

export function AppImage({
  uri,
  fallback = null,
  fit = 'cover',
  highPriority = false,
  recyclingKey,
  transition = 90,
  onError,
  ...props
}: AppImageProps) {
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [waitingForNetwork, setWaitingForNetwork] = useState(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cacheKey = useMemo(() => (uri ? stableImageCacheKey(uri) : ''), [uri]);

  useEffect(() => {
    setRetryAttempt(0);
    setWaitingForNetwork(false);
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [uri]);

  useEffect(() => {
    if (!waitingForNetwork) return undefined;
    return NetInfo.addEventListener(network => {
      if (network.isConnected && network.isInternetReachable !== false) {
        setWaitingForNetwork(false);
        setRetryAttempt(current => current + 1);
      }
    });
  }, [waitingForNetwork]);

  if (!uri || retryAttempt > retryDelaysMs.length) {
    return fallback ? <>{fallback}</> : <View style={props.style} />;
  }

  return (
    <ExpoImage
      {...props}
      source={{ uri, cacheKey }}
      cachePolicy="memory-disk"
      contentFit={fit}
      priority={highPriority ? 'high' : 'normal'}
      recyclingKey={recyclingKey ?? cacheKey}
      transition={transition}
      onError={event => {
        onError?.(event);
        if (retryTimer.current) clearTimeout(retryTimer.current);
        const delay = retryDelaysMs[retryAttempt];
        if (delay === undefined) {
          setRetryAttempt(current => current + 1);
          return;
        }
        retryTimer.current = setTimeout(() => {
          void NetInfo.fetch().then(network => {
            if (network.isConnected && network.isInternetReachable !== false) {
              setRetryAttempt(current => current + 1);
            } else {
              setWaitingForNetwork(true);
            }
          });
        }, delay);
      }}
    />
  );
}

export async function prefetchAppImages(
  uris: Array<string | null | undefined>,
) {
  const unique = [
    ...new Set(uris.filter((uri): uri is string => Boolean(uri))),
  ].slice(0, 8);
  if (unique.length === 0) return;
  const network = await NetInfo.fetch();
  if (!network.isConnected || network.isInternetReachable === false) return;
  await ExpoImage.prefetch(unique, { cachePolicy: 'memory-disk' });
}
