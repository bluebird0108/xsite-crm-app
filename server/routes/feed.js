// /api/feed — PUBLIC XML listing feeds the property portals PULL on a schedule.
// Two endpoints:
//   /api/feed/pf.xml     -> Property Finder
//   /api/feed/bayut.xml  -> Bayut + Dubizzle (one feed; per-listing portal flags)
//
// A feed only includes rows that are status='published', have the relevant portal
// toggle ON, and carry a DLD Trakheesi permit_number (legal gate). Access is
// guarded by a shared ?key=<FEED_KEY> secret (set FEED_KEY in server/.env; if
// unset the feed is open). Register the full URL (with the key) in each portal.
//
// NOTE: this is scaffolded to the COMMON UAE feed shape. The exact tag names,
// offering/property-type ENUM CODES, rent-period codes and location taxonomy
// differ per portal and MUST be reconciled against each portal's own feed spec
// (they test the feed and report errors on activation). Search "RECONCILE".
const router = require("express").Router();
const { q } = require("../db");

const FEED_KEY = process.env.FEED_KEY || "";

function keyOk(req, res) {
  if (FEED_KEY && req.query.key !== FEED_KEY) { res.status(403).send("Forbidden"); return false; }
  return true;
}

const xe = (s) => String(s == null ? "" : s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
const cdata = (s) => `<![CDATA[${String(s == null ? "" : s).replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;

// RECONCILE: property-type + offering-type codes with each portal's spec.
const COMMERCIAL = new Set(["Office", "Shop", "Warehouse", "Land", "Building", "Labour Camp"]);
const PF_PTYPE = { Apartment: "AP", Villa: "VH", Townhouse: "TH", Penthouse: "PH", Duplex: "DX",
  Office: "OF", Shop: "SR", Warehouse: "WH", Land: "PL", Building: "BU", "Labour Camp": "LC" };
// PF offering_type: R/C (residential/commercial) + S/R (sale/rent) -> RS/RR/CS/CR
const pfOffering = (l) => (COMMERCIAL.has(l.property_type) ? "C" : "R") + (l.offering_type === "sale" ? "S" : "R");
const pfFurnished = (f) => (/^furnished/i.test(f || "") ? "Yes" : /partly/i.test(f || "") ? "Partly" : "No");
const pfBeds = (b) => (/studio/i.test(b || "") ? "studio" : (b || ""));

// Only published + toggled-on + permit-bearing rows. `flag` is a fixed column name
// (whitelisted here), never user input, so string interpolation is safe.
async function fetchForFeed(flags) {
  const cond = flags.map((f) => `coalesce(${f}, false) = true`).join(" or ");
  const r = await q(
    `select * from listings
      where status = 'published' and (${cond})
        and permit_number is not null and btrim(permit_number) <> ''
      order by updated_at desc`, []);
  return r.rows;
}

function pfXml(rows) {
  const body = rows.map((l) => {
    const imgs = (l.photos || []).map((u) => `        <image><url>${cdata(u)}</url></image>`).join("\n");
    return `    <property>
      <reference_number>${xe(l.ref_no || l.id)}</reference_number>
      <permit_number>${xe(l.permit_number)}</permit_number>
      <offering_type>${xe(pfOffering(l))}</offering_type>
      <property_type>${xe(PF_PTYPE[l.property_type] || "AP")}</property_type>
      <price>${xe(l.price)}</price>${l.offering_type === "rent" ? `\n      <rent_period>${xe(l.rent_period || "yearly")}</rent_period>` : ""}
      <city>${xe(l.city || "Dubai")}</city>
      <community>${xe(l.community)}</community>
      <sub_community>${xe(l.sub_community)}</sub_community>
      <property_name>${xe(l.tower)}</property_name>
      <title_en>${cdata(l.title)}</title_en>
      <description_en>${cdata(l.description)}</description_en>
      <size>${xe(l.size_sqft)}</size>
      <bedroom>${xe(pfBeds(l.bedrooms))}</bedroom>
      <bathroom>${xe(l.bathrooms)}</bathroom>
      <furnished>${xe(pfFurnished(l.furnishing))}</furnished>
      <private_amenities>${xe((l.amenities || []).join(","))}</private_amenities>
      <agent><name>${xe(l.agent_name)}</name></agent>
      <images>
${imgs}
      </images>
    </property>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<list>\n${body}\n</list>\n`;
}

function bayutXml(rows) {
  const body = rows.map((l) => {
    const imgs = (l.photos || []).map((u) => `        <Image_URL>${cdata(u)}</Image_URL>`).join("\n");
    const purpose = l.offering_type === "sale" ? "for-sale" : "for-rent";
    return `    <Property>
      <Reference_Number>${xe(l.ref_no || l.id)}</Reference_Number>
      <Permit_Number>${xe(l.permit_number)}</Permit_Number>
      <Purpose>${xe(purpose)}</Purpose>
      <Property_Type>${xe(l.property_type)}</Property_Type>
      <Price>${xe(l.price)}</Price>${l.offering_type === "rent" ? `\n      <Rent_Frequency>${xe(l.rent_period || "yearly")}</Rent_Frequency>` : ""}
      <City>${xe(l.city || "Dubai")}</City>
      <Community>${xe(l.community)}</Community>
      <Sub_Community>${xe(l.sub_community)}</Sub_Community>
      <Tower_Name>${xe(l.tower)}</Tower_Name>
      <Title>${cdata(l.title)}</Title>
      <Description>${cdata(l.description)}</Description>
      <Size>${xe(l.size_sqft)}</Size>
      <Bedrooms>${xe(l.bedrooms)}</Bedrooms>
      <Bathrooms>${xe(l.bathrooms)}</Bathrooms>
      <Furnished>${xe(pfFurnished(l.furnishing))}</Furnished>
      <Amenities>${xe((l.amenities || []).join(","))}</Amenities>
      <Agent_Name>${xe(l.agent_name)}</Agent_Name>
      <Publish_On_Bayut>${l.publish_bayut ? 1 : 0}</Publish_On_Bayut>
      <Publish_On_Dubizzle>${l.publish_dubizzle ? 1 : 0}</Publish_On_Dubizzle>
      <Images>
${imgs}
      </Images>
    </Property>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Properties>\n${body}\n</Properties>\n`;
}

router.get("/pf.xml", async (req, res) => {
  if (!keyOk(req, res)) return;
  try {
    const rows = await fetchForFeed(["publish_pf"]);
    res.type("application/xml").send(pfXml(rows));
  } catch (e) { res.status(500).send("Feed error"); }
});

router.get("/bayut.xml", async (req, res) => {
  if (!keyOk(req, res)) return;
  try {
    const rows = await fetchForFeed(["publish_bayut", "publish_dubizzle"]);
    res.type("application/xml").send(bayutXml(rows));
  } catch (e) { res.status(500).send("Feed error"); }
});

module.exports = router;
