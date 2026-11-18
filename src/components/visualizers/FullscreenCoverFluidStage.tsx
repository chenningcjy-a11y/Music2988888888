import React, { useEffect, useState } from 'react';
import { Disc3 } from 'lucide-react';

interface FullscreenCoverFluidStageProps {
  coverUrl?: string;
  title: string;
  trackId?: string;
}

export const FullscreenCoverFluidStage: React.FC<FullscreenCoverFluidStageProps> = ({
  coverUrl,
  title,
  trackId,
}) => {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [coverUrl, trackId]);

  return (
    <div className="relative flex items-center justify-center select-none">
      {/* Plain stationary square album cover */}
      <div
        className="relative w-[clamp(150px,min(35vh,30vw),340px)] aspect-square shrink-0 rounded-[28px] overflow-hidden bg-[#160812]"
        style={{
          boxShadow:
            '0 24px 64px rgba(0, 0, 0, 0.65), 0 8px 24px rgba(0, 0, 0, 0.42)',
        }}
      >
        {coverUrl && !imgError ? (
          <img
            key={`${trackId || 'none'}-${coverUrl.slice(0, 48)}`}
            src={coverUrl}
            alt={title}
            referrerPolicy="no-referrer"
            draggable={false}
            onError={() => setImgError(true)}
            className="w-full h-full object-cover block"
          />
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              background:
                'linear-gradient(145deg, rgba(255,255,255,0.08), rgba(0,0,0,0.55))',
            }}
          >
            <Disc3 className="w-16 h-16 text-white/35" />
          </div>
        )}
      </div>
    </div>
  );
};
