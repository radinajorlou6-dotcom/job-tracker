const express = require('express');
const prisma = require('../prisma');

const router = express.Router();

async function importListings() {
    const response = await fetch('https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json');
    const listings = await response.json();
    for (const listing of listings) {
        const data = {
            source: listing.source,
            category: listing.category,
            company: listing.company_name,
            role: listing.title,
            active: listing.active,
            terms: listing.terms ?? [],
            dateUpdated: new Date(listing.date_updated * 1000),
            datePosted: new Date(listing.date_posted * 1000),
            url: listing.url,
            locations: listing.locations ?? [],
            companyUrl: listing.company_url,
            isVisible: listing.is_visible,
            sponsorship: listing.sponsorship,
            degrees: listing.degrees ?? [],
        }
        await prisma.listing.upsert({
            where: { sourceId: listing.id },
            update: data,
            create:{ sourceId: listing.id, ...data},
        })
    }
}

router.get('/import', async (req, res) => {
    await importListings();
    const listings = await prisma.listing.findMany();
    res.json(listings);
});

module.exports = { router, importListings };
