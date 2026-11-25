package com.secondshooter.nativepoc.media

import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Calendar

/** The same cases as describeFolderUri in src/__tests__/utils/saveFolder.test.ts. */
class SaveFolderTest {
    @Test
    fun turnsATreeUriIntoAReadablePath() {
        assertEquals(
            "DCIM/Shoots",
            SaveFolder.describe("content://com.android.externalstorage.documents/tree/primary%3ADCIM%2FShoots"),
        )
    }

    @Test
    fun ignoresATrailingDocumentSegment() {
        assertEquals(
            "DCIM/Shoots",
            SaveFolder.describe(
                "content://com.android.externalstorage.documents/tree/primary%3ADCIM%2FShoots/document/primary%3ADCIM%2FShoots"
            ),
        )
    }

    @Test
    fun namesTheStorageRootWhenTheFolderIsTheVolumeItself() {
        assertEquals("Internal storage", SaveFolder.describe("content://com.android.externalstorage.documents/tree/primary%3A"))
    }

    @Test
    fun marksFoldersOnARemovableVolume() {
        assertEquals("SD card/Photos", SaveFolder.describe("content://com.android.externalstorage.documents/tree/1AEF-2B01%3APhotos"))
    }

    @Test
    fun keepsAPlusSignInAFolderName() {
        assertEquals("DCIM/A+B", SaveFolder.describe("content://com.android.externalstorage.documents/tree/primary%3ADCIM%2FA+B"))
    }

    @Test
    fun fallsBackToTheRawUriWhenItIsNotATreeUri() {
        assertEquals("file:///storage/emulated/0/DCIM", SaveFolder.describe("file:///storage/emulated/0/DCIM"))
    }

    @Test
    fun namesCapturesLikeTheReactNativeApp() {
        val date = Calendar.getInstance().apply { set(2026, Calendar.NOVEMBER, 25, 9, 5, 7); set(Calendar.MILLISECOND, 42) }.time
        assertEquals("SecondShooter_IMG_20261125_090507_042", CaptureNames.photo(date))
        assertEquals("SecondShooter_VID_20261125_090507_042", CaptureNames.video(date))
    }
}
