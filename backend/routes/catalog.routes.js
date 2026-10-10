const express = require("express");
const pool = require("../db");
const { toPublicPhotoUrl } = require("../lib/photoUrl");

const router = express.Router();

const availableRoomWhere = `
  r.status NOT IN ('maintenance', 'inactive')
  AND r.current_occupancy < r.capacity
`;

function mapRoom(row) {
  return {
    id: row.id,
    roomNumber: row.room_number,
    floor: row.floor,
    // rooms has no room_type column; owner/tenant mappers derive this from
    // floor, so the catalog does the same to keep the client field stable.
    roomType: row.floor || null,
    description: row.description,
    price: Number(row.monthly_rent),
    monthlyRent: Number(row.monthly_rent),
    capacity: row.capacity,
    currentOccupancy: row.current_occupancy,
    availability: row.status === "available" && row.current_occupancy < row.capacity,
    status: row.status,
    amenities: row.amenities || [],
  };
}

// Aggregated photos for a property: primary first, then oldest.
const PHOTOS_JSON = `
  COALESCE((
    SELECT json_agg(
      json_build_object(
        'id', pp.id,
        'photo_url', pp.photo_url,
        'is_primary', pp.is_primary
      )
      ORDER BY pp.is_primary DESC, pp.created_at ASC
    )
    FROM property_photos pp
    WHERE pp.property_id = p.id
  ), '[]'::json) AS photos
`;

// Best photo to show as a map marker / list thumbnail.
const PRIMARY_PHOTO_URL = `
  (SELECT pp.photo_url FROM property_photos pp
   WHERE pp.property_id = p.id
   ORDER BY pp.is_primary DESC, pp.created_at ASC
   LIMIT 1) AS primary_photo_url
`;

function mapPhoto(req, p) {
  return { id: p.id, photoUrl: toPublicPhotoUrl(req, p.photo_url), isPrimary: p.is_primary };
}

router.get("/properties", async (req, res) => {
  try {
    const { search } = req.query;
    const params = [];
    let query = `
      SELECT p.id, p.name, p.address, p.description, p.contact_number,
             p.latitude, p.longitude,
             u.name AS owner_name, u.phone AS owner_phone,
             ${PRIMARY_PHOTO_URL},
             COUNT(r.id) FILTER (WHERE ${availableRoomWhere})::int AS available_rooms
      FROM properties p
      JOIN users u ON u.id = p.owner_id AND u.role = 'owner' AND u.status = 'active'
      LEFT JOIN rooms r ON r.property_id = p.id
      WHERE p.status = 'active'
    `;

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (LOWER(p.name) LIKE LOWER($1) OR LOWER(p.address) LIKE LOWER($1))`;
    }

    query += ` GROUP BY p.id, u.name, u.phone ORDER BY p.name`;
    const result = await pool.query(query, params);

    return res.json({
      success: true,
      data: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        address: row.address,
        description: row.description,
        contactNumber: row.contact_number,
        latitude: row.latitude != null ? Number(row.latitude) : null,
        longitude: row.longitude != null ? Number(row.longitude) : null,
        ownerName: row.owner_name,
        ownerPhone: row.owner_phone,
        availableRooms: row.available_rooms,
        primaryPhotoUrl: toPublicPhotoUrl(req, row.primary_photo_url),
      })),
    });
  } catch (error) {
    console.error("Browse properties error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/properties/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.name, p.address, p.description, p.contact_number,
              p.latitude, p.longitude,
              u.name AS owner_name, u.phone AS owner_phone,
              ${PHOTOS_JSON}
       FROM properties p
       JOIN users u ON u.id = p.owner_id AND u.role = 'owner' AND u.status = 'active'
       WHERE p.id = $1 AND p.status = 'active'`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Property not found" });
    }

    const property = result.rows[0];
    const rooms = await pool.query(
      `SELECT r.id, r.room_number, r.floor, r.description, r.monthly_rent,
              r.capacity, r.current_occupancy, r.status, r.amenities
       FROM rooms r
       WHERE r.property_id = $1 AND ${availableRoomWhere}
       ORDER BY r.room_number`,
      [req.params.id]
    );

    return res.json({
      success: true,
      data: {
        id: property.id,
        name: property.name,
        address: property.address,
        description: property.description,
        contactNumber: property.contact_number,
        latitude: property.latitude != null ? Number(property.latitude) : null,
        longitude: property.longitude != null ? Number(property.longitude) : null,
        ownerName: property.owner_name,
        ownerPhone: property.owner_phone,
        photos: (property.photos || []).map((p) => mapPhoto(req, p)),
        rooms: rooms.rows.map(mapRoom),
      },
    });
  } catch (error) {
    console.error("Browse property error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Public property photos for a single active property.
router.get("/properties/:id/photos", async (req, res) => {
  try {
    const { id } = req.params;
    const propCheck = await pool.query(
      `SELECT id FROM properties WHERE id = $1 AND status = 'active'`,
      [id]
    );
    if (propCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Property not found" });
    }

    const result = await pool.query(
      `SELECT id, photo_url, is_primary, created_at
       FROM property_photos
       WHERE property_id = $1
       ORDER BY is_primary DESC, created_at ASC`,
      [id]
    );

    return res.json({
      success: true,
      data: result.rows.map((r) => ({
        id: r.id,
        photoUrl: toPublicPhotoUrl(req, r.photo_url),
        isPrimary: r.is_primary,
        createdAt: r.created_at,
      })),
    });
  } catch (error) {
    console.error("Get public property photos error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/properties/:id/rooms", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.room_number, r.floor, r.description, r.monthly_rent,
              r.capacity, r.current_occupancy, r.status, r.amenities
       FROM rooms r
       JOIN properties p ON p.id = r.property_id AND p.status = 'active'
       JOIN users u ON u.id = p.owner_id AND u.role = 'owner' AND u.status = 'active'
       WHERE r.property_id = $1 AND ${availableRoomWhere}
       ORDER BY r.room_number`,
      [req.params.id]
    );
    return res.json({ success: true, data: result.rows.map(mapRoom) });
  } catch (error) {
    console.error("Browse property rooms error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/rooms/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.room_number, r.floor, r.description, r.monthly_rent,
              r.capacity, r.current_occupancy, r.status, r.amenities,
              p.id AS property_id, p.name AS property_name, p.address,
              p.contact_number, p.latitude, p.longitude, u.name AS owner_name, u.phone AS owner_phone
       FROM rooms r
       JOIN properties p ON p.id = r.property_id AND p.status = 'active'
       JOIN users u ON u.id = p.owner_id AND u.role = 'owner' AND u.status = 'active'
       WHERE r.id = $1 AND ${availableRoomWhere}`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Available room not found" });
    }

    const room = result.rows[0];
    return res.json({
      success: true,
      data: {
        ...mapRoom(room),
        propertyId: room.property_id,
        propertyName: room.property_name,
        propertyAddress: room.address,
        propertyContact: room.contact_number,
        propertyLatitude: room.latitude != null ? Number(room.latitude) : null,
        propertyLongitude: room.longitude != null ? Number(room.longitude) : null,
        ownerName: room.owner_name,
        ownerPhone: room.owner_phone,
      },
    });
  } catch (error) {
    console.error("Browse room error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
