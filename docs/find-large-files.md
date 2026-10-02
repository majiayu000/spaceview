# Find large files on a Mac with SpaceView

SpaceView is the Tauri desktop disk analyzer in `majiayu000/spaceview`. This guide
starts with a selected folder and a rectangular treemap. It is a source-distributed
application; follow [installation](../README.md#installation) before scanning.

## Start with one folder you recognize

1. Choose **Open Folder**, or press `Cmd+O`. Start with Downloads or a project
   directory rather than assuming the app is showing the entire disk.
2. Wait for the scan to finish. The app shows file-scan progress; cancelling a
   scan is different from a completed scan.
3. Find the largest rectangles. Their area represents the file or folder size.
   Click into a folder and use the breadcrumb to return to its parent.
4. Use **Search files** for a name you recognize, or the file-type filter to focus
   on videos, archives, or another category. Clear the search/filter to restore
   the wider view before drawing conclusions about what is largest.

## Inspect a candidate before removing it

Right-click an item and use **Show in Finder** or **Open** to identify its actual
location and purpose. If you decide to remove it, **Move to Trash** uses the
system trash mechanism. Finder remains useful for checking the Trash afterwards;
removing an item from the treemap is not the same as immediately reclaiming all
physical space on the volume.

The app displays recent deletes and scan state. If a filesystem change is not
reflected, refresh/rescan the selected folder and inspect any visible error
instead of treating cached results as a fresh completed scan.

## Why does the total differ from macOS Storage?

SpaceView analyzes the selected tree. It does not identify every byte used by
system storage, other folders, or a whole-volume accounting tool. The scanner
uses file metadata sizes, does not follow symbolic links, and deduplicates files
by device/inode so hard links are not counted repeatedly. Files that cannot be
read or statted can also affect the result. A partial scan is not proof that the
rest of the disk is empty.

If scanning fails, keep the selected folder, app/commit version, visible error,
and whether the view was cached or freshly scanned. Test a folder you can read;
do not assume a missing permission will be repaired by the visualization.

## Which visualization do I want?

[GrandPerspective](https://grandperspectiv.sourceforge.net/) also documents a
rectangular treemap; [DaisyDisk's scanning guide](https://web.daisydiskapp.com/guide/4/en/DisksOverview)
describes its own disk-selection and scanning workflow. Review their current
documentation when choosing an interface. No comparative speed, accuracy, or
whole-disk coverage is established by this guide.

[Usage and screenshots](../README.md#usage) · [License](../LICENSE) ·
[Report a problem](https://github.com/majiayu000/spaceview/issues)
