import gb from '@/assets/flags/gb.svg';
import ir from '@/assets/flags/ir.svg';
import sa from '@/assets/flags/sa.svg';
import tr from '@/assets/flags/tr.svg';
import fr from '@/assets/flags/fr.svg';
import de from '@/assets/flags/de.svg';
import es from '@/assets/flags/es.svg';
import ru from '@/assets/flags/ru.svg';
import cn from '@/assets/flags/cn.svg';
import inn from '@/assets/flags/in.svg';
import pt from '@/assets/flags/pt.svg';
import it from '@/assets/flags/it.svg';
import nl from '@/assets/flags/nl.svg';
import jp from '@/assets/flags/jp.svg';
import kr from '@/assets/flags/kr.svg';
import pk from '@/assets/flags/pk.svg';
import idn from '@/assets/flags/id.svg';
import pl from '@/assets/flags/pl.svg';
import ua from '@/assets/flags/ua.svg';
import vn from '@/assets/flags/vn.svg';
import tw from '@/assets/flags/tw.svg';
import il from '@/assets/flags/il.svg';
import ku from '@/assets/flags/ku.svg';
import az from '@/assets/flags/az.svg';
import bd from '@/assets/flags/bd.svg';
import th from '@/assets/flags/th.svg';
import my from '@/assets/flags/my.svg';
import ph from '@/assets/flags/ph.svg';
import se from '@/assets/flags/se.svg';
import no from '@/assets/flags/no.svg';
import dk from '@/assets/flags/dk.svg';
import fi from '@/assets/flags/fi.svg';
import gr from '@/assets/flags/gr.svg';
import hu from '@/assets/flags/hu.svg';
import cz from '@/assets/flags/cz.svg';
import ro from '@/assets/flags/ro.svg';
import br from '@/assets/flags/br.svg';
import mx from '@/assets/flags/mx.svg';

const FLAGS: Record<string, string> = {
  gb, ir, sa, tr, fr, de, es, ru, cn, in: inn,
  pt, it, nl, jp, kr, pk, id: idn, pl, ua, vn,
  tw, il, ku, az, bd, th, my, ph, se, no, dk, fi,
  gr, hu, cz, ro, br, mx,
};

/**
 * Small rounded flag image. SVG files are bundled locally (no network,
 * no emoji-font dependency — Windows has no flag-emoji support, so flag
 * emojis render as plain "GB"/"IR" letters there).
 */
export default function FlagIcon({ country, name }: { country: string; name: string }) {
  const src = FLAGS[country];
  if (!src) return null;
  return (
    <img
      className="lang-flag-img"
      src={src}
      alt=""
      aria-hidden="true"
      draggable={false}
      title={name}
    />
  );
}
