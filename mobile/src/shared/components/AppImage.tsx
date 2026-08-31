import NetInfo from '@react-native-community/netinfo';
import { Image as ExpoImage, type ImageProps } from 'expo-image';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

const retryDelaysMs = [450, 1_200] as const;

type AppImageCacheConfiguration = {
  cachePolicy: 'memory' | 'memory-disk';
  cacheKey?: string;
  recyclingKey: string;
};

function stableImageCacheKey(uri: string): string {
  try {
    const parsed = new URL(uri);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return uri.split(/[?#]/u)[0] ?? uri;
  }
}

function isSignedProfilePhotoUrl(uri: string): boolean {
  try {
    const pathname = decodeURIComponent(new URL(uri).pathname);
    return /\/storage\/v1\/(?:object|render\/image)\/sign\/profile-photos(?:\/|$)/iu.test(
      pathname,
    );
  } catch {
    return false;
  }
}

export function appImageCacheConfiguration(
  uri: string,
): AppImageCacheConfiguration {
  if (isSignedProfilePhotoUrl(uri)) {
    return { cachePolicy: 'memory', recyclingKey: uri };
  }
  const cacheKey = stableImageCacheKey(uri);
  return {
    cachePolicy: 'memory-disk',
    cacheKey,
    recyclingKey: cacheKey,
  };
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
  const cacheConfiguration = useMemo(
    () => (uri ? appImageCacheConfiguration(uri) : null),
    [uri],
  );

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
      source={
        cacheConfiguration?.cacheKey
          ? { uri, cacheKey: cacheConfiguration.cacheKey }
          : { uri }
      }
      cachePolicy={cacheConfiguration?.cachePolicy ?? 'memory'}
      contentFit={fit}
      priority={highPriority ? 'high' : 'normal'}
      recyclingKey={recyclingKey ?? cacheConfiguration?.recyclingKey}
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
  const privateUris = unique.filter(isSignedProfilePhotoUrl);
  const publicUris = unique.filter(uri => !isSignedProfilePhotoUrl(uri));
  await Promise.all([
    privateUris.length > 0
      ? ExpoImage.prefetch(privateUris, { cachePolicy: 'memory' })
      : Promise.resolve(false),
    publicUris.length > 0
      ? ExpoImage.prefetch(publicUris, { cachePolicy: 'memory-disk' })
      : Promise.resolve(false),
  ]);
}
